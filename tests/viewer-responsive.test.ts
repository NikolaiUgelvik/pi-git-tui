import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"
import { BranchPickerController } from "../src/branch-picker-controller.js"
import { CommandMenuController } from "../src/command-menu-controller.js"
import { CommitPickerController } from "../src/commit-picker-controller.js"
import { buildCommitDocument } from "../src/diff-document.js"
import { StashPickerController } from "../src/stash-picker-controller.js"
import type { DiffFile } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { WorktreePickerController } from "../src/worktree-picker-controller.js"
import { testTheme, workingDocument } from "./helpers/viewer.js"

const widths = [30, 50, 70, 120]
const heights = [10, 16, 24]

function changedFile(path: string, text = "abcdefghijklmnopqrstuvwxyz界e\u0301🇺🇦"): DiffFile {
  return {
    path,
    status: "modified",
    stageState: "unstaged",
    lines: [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", "-old", `+${text}`],
  }
}

class ResponsiveViewer extends DiffViewer {
  selectedPath(): string | undefined {
    return this.files[this.selectedFileIndex]?.path
  }

  column(): number {
    return this.diffColumn
  }

  helpOffset(): number {
    return this.helpOverlayState.offset
  }
}

function viewer(rows: () => number, files = [changedFile("first.ts"), changedFile("second.ts")]): ResponsiveViewer {
  return new ResponsiveViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: files }),
    () => {},
    () => {},
    rows,
  )
}

function assertBounded(lines: string[], width: number, rows: number): void {
  assert.equal(lines.length, rows - 2)
  for (const line of lines) {
    assert.equal(visibleWidth(line), width)
  }
}

test("viewer output is bounded across the responsive width and height matrix", () => {
  for (const width of widths) {
    for (const rows of heights) {
      const diffViewer = viewer(() => rows)
      const treeFrame = diffViewer.render(width)
      assertBounded(treeFrame, width, rows)
      assert.match(treeFrame.join("\n"), /Files/u)
      assert.equal(treeFrame.join("\n").includes("abcdefghijklmnopqrstuvwxyz"), width >= 72)

      if (width < 72) {
        diffViewer.handleInput("\t")
        const diffFrame = diffViewer.render(width)
        assertBounded(diffFrame, width, rows)
        assert.match(diffFrame.join("\n"), /Diff/u)
      }
    }
  }
})

test("narrow panel switching and resizing preserve selection and horizontal state", () => {
  let rows = 16
  const diffViewer = viewer(() => rows)
  diffViewer.handleInput("\x1b[B")
  assert.equal(diffViewer.selectedPath(), "second.ts")
  diffViewer.render(30)
  diffViewer.handleInput("\t")
  diffViewer.handleInput("\x1b[C")
  diffViewer.render(30)
  assert.equal(diffViewer.column(), 4)
  assert.match(diffViewer.render(30).join("\n"), /col 5/u)

  diffViewer.handleInput("\t")
  assert.equal(diffViewer.column(), 4)
  diffViewer.handleInput("\t")
  assert.equal(diffViewer.column(), 4)
  diffViewer.render(120)
  assert.equal(diffViewer.selectedPath(), "second.ts")
  assert.equal(diffViewer.column(), 0)

  diffViewer.render(30)
  diffViewer.handleInput("\x1b[C")
  diffViewer.render(30)
  diffViewer.handleInput("n")
  assert.equal(diffViewer.selectedPath(), "second.ts")
  assert.equal(diffViewer.column(), 4)
  diffViewer.handleInput("p")
  assert.equal(diffViewer.selectedPath(), "first.ts")
  assert.equal(diffViewer.column(), 0)

  rows = 10
  assertBounded(diffViewer.render(50), 50, rows)
})

test("clean and missing documents render one full-width summary panel", () => {
  for (const repositoryState of ["ready", "missing"] as const) {
    const diffViewer = new ResponsiveViewer(
      {} as ExtensionAPI,
      { cwd: "/repo" } as ExtensionContext,
      testTheme,
      workingDocument("/repo", { repositoryState, workingFiles: [] }),
      () => {},
      () => {},
      () => 16,
    )
    const rendered = diffViewer.render(120).join("\n")
    assert.match(rendered, /Summary/u)
    assert.doesNotMatch(rendered, /Files .*│.* Diff/u)
  }
})

test("file selection has a textual marker with a no-color theme", () => {
  const diffViewer = viewer(() => 16)

  const firstFrame = diffViewer.render(80).join("\n")
  assert.match(firstFrame, /▶ ○ M first\.ts/u)
  assert.doesNotMatch(firstFrame, /▶ ○ M second\.ts/u)

  diffViewer.handleInput("\x1b[B")
  const secondFrame = diffViewer.render(80).join("\n")
  assert.match(secondFrame, /▶ ○ M second\.ts/u)
  assert.doesNotMatch(secondFrame, /▶ ○ M first\.ts/u)
})

test("30-column footers keep one contextual action, help, and close", () => {
  const workingViewer = viewer(() => 10)
  const treeFooter = workingViewer.render(30).at(-2) ?? ""
  assert.match(treeFooter, /↵ stage/u)
  assert.match(treeFooter, /\? help/u)
  assert.match(treeFooter, /q close/u)

  workingViewer.handleInput("\t")
  const diffFooter = workingViewer.render(30).at(-2) ?? ""
  assert.match(diffFooter, /↑↓ scroll/u)
  assert.match(diffFooter, /\? help/u)
  assert.match(diffFooter, /q close/u)

  const historical = new ResponsiveViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    buildCommitDocument({
      title: "Commit abc123",
      subtitle: "/repo • historical",
      raw: "diff --git a/first.ts b/first.ts",
      commit: { hash: "abc123", message: "historical" },
    }),
    () => {},
    () => {},
    () => 10,
  )
  const historicalFooter = historical.render(30).at(-2) ?? ""
  assert.match(historicalFooter, /W tree/u)
  assert.match(historicalFooter, /\? help/u)
  assert.match(historicalFooter, /q close/u)
})

test("navigation footers put help first and preserve contextual escape and close actions", () => {
  const historical = new ResponsiveViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    buildCommitDocument({
      title: "Commit abc123",
      subtitle: "/repo • historical",
      raw: "diff --git a/first.ts b/first.ts",
      commit: { hash: "abc123", message: "historical" },
    }),
    () => {},
    () => {},
    () => 16,
  )

  for (const width of [80, 100, 120]) {
    const workingFooter =
      viewer(() => 16)
        .render(width)
        .at(-2) ?? ""
    assert.match(workingFooter, /\? help • q close/u)

    const historicalFooter = historical.render(width).at(-2) ?? ""
    assert.match(historicalFooter, /\? help • q close • W tree/u)
  }
})

test("help is height-bounded and every action is reachable", () => {
  const diffViewer = viewer(() => 10)
  diffViewer.handleInput("?")
  const firstPage = diffViewer.render(50)
  assertBounded(firstPage, 50, 10)
  assert.match(firstPage.join("\n"), /Ctrl\+P.*Open the Git command menu/u)
  assert.equal(diffViewer.helpOffset(), 0)

  diffViewer.handleInput("\x1b[6~")
  diffViewer.render(50)
  assert.ok(diffViewer.helpOffset() > 0)
  diffViewer.handleInput("\x1b[F")
  const lastPage = diffViewer.render(50).join("\n")
  assert.match(lastPage, /Show or close this help/u)
  diffViewer.handleInput("\x1b[H")
  diffViewer.render(50)
  assert.equal(diffViewer.helpOffset(), 0)
})

test("30-column help wraps complete actions and keeps the close hint visible", () => {
  const diffViewer = viewer(() => 10)
  diffViewer.handleInput("?")

  const firstPage = diffViewer.render(30).join("\n")
  assert.match(firstPage, /Esc close/u)

  diffViewer.handleInput("\x1b[F")
  const lastPage = diffViewer.render(30)
  const compactText = lastPage.join("").replace(/[\s│╭╮╰╯─]/gu, "")
  assert.match(compactText, /Showorclose.*thishelp/u)
  const hint = lastPage.find((line) => line.includes("Esc close")) ?? ""
  const hintStart = hint.indexOf("Esc close")
  const hintEnd = hint.indexOf("│", hintStart)
  assert.doesNotMatch(hint.slice(hintStart, hintEnd), /…/u)
})

test("compact confirmation and commit dialogs remain inside a 30 by 10 terminal", () => {
  const discardViewer = viewer(() => 10, [changedFile("discard-me.ts")])
  discardViewer.handleInput("D")
  const confirmation = discardViewer.render(30)
  assertBounded(confirmation, 30, 10)
  assert.match(confirmation.join("\n"), /Enter: Discard/u)

  const staged = { ...changedFile("staged.ts"), stageState: "staged" as const }
  const commitViewer = new ResponsiveViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { stagedFiles: [staged] }),
    () => {},
    () => {},
    () => 10,
  )
  commitViewer.handleInput("C")
  commitViewer.handleInput("C")
  const dialog = commitViewer.render(30)
  assertBounded(dialog, 30, 10)
  assert.match(dialog.join("\n"), /Commit staged changes/u)
})

test("every picker family renders bounded normal and compact overlays", () => {
  const callbacks = { onRequestRender: () => {}, onClose: () => {} }
  const commit = new CommitPickerController({
    ...callbacks,
    onSelectWorkingTree: () => {},
    onSelectCommit: () => {},
  })
  commit.open(Array.from({ length: 20 }, (_, index) => ({ hash: `${index}`, message: `commit ${index}` })))
  const command = new CommandMenuController({ ...callbacks, onRunCommand: () => {}, onPreviewForcePush: () => {} })
  command.open()
  const branch = new BranchPickerController({
    ...callbacks,
    onSwitch: () => {},
    onCreate: () => {},
    onValidationError: () => {},
  })
  branch.open(Array.from({ length: 20 }, (_, index) => ({ name: `branch-${index}`, current: index === 0 })))
  const stash = new StashPickerController({
    ...callbacks,
    onStashCurrent: () => {},
    onApply: () => {},
    onPop: () => {},
    onDrop: () => {},
    onRetryList: () => {},
  })
  stash.open(Array.from({ length: 20 }, (_, index) => ({ ref: `stash@{${index}}`, message: `stash ${index}` })))
  const worktree = new WorktreePickerController({ ...callbacks, onSwitch: () => {} })
  worktree.open(
    Array.from({ length: 20 }, (_, index) => ({ path: `/repo/${index}`, branch: `branch-${index}` })),
    "/repo/0",
  )

  const controllers = [commit, command, branch, stash, worktree]
  for (const width of widths) {
    for (const rows of heights) {
      for (const controller of controllers) {
        const lines = controller.renderOverlayLines(rows - 2, width, testTheme)
        assert.ok(lines.length <= rows - 2)
        assert.ok(lines.length > 0)
        for (const line of lines) {
          assert.ok(visibleWidth(line) <= width)
        }
        if (lines.length >= 2) {
          assert.match(lines[0] ?? "", /╭/u)
          assert.match(lines.at(-1) ?? "", /╯/u)
        }
      }
    }
  }
})
