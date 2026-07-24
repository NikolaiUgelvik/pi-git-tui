import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { buildWorkingTreeDocument } from "../src/diff-document.js"
import type { WorkingTreeDocument } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import {
  flushViewerWork,
  gitResult,
  testTheme,
  testViewerOptions,
  workingDocument,
  workingSnapshotResult,
} from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

function patch(path: string, before: string, after: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
  ].join("\n")
}

function indexExactDocument(): WorkingTreeDocument {
  return buildWorkingTreeDocument({
    title: "Working tree and index",
    subtitle: "/repo (main)",
    stagedRaw: [patch("mixed.txt", "base", "staged content"), patch("staged-only.txt", "base", "staged only")].join(
      "\n",
    ),
    workingRaw: [
      patch("mixed.txt", "staged content", "working content"),
      patch("working-only.txt", "base", "working only"),
    ].join("\n"),
    headState: "present",
  })
}

class IndexViewViewer extends DiffViewer {
  activeScope(): string {
    return this.visibleSlice.scope
  }

  dialogState(): string {
    return this.commitDialogState
  }

  currentError(): string | undefined {
    return this.error
  }

  formattedStats(stats: { files: number; additions: number; deletions: number }): string {
    return this.formatDiffStats(stats)
  }
}

function viewer(document: WorkingTreeDocument, pi = {} as ExtensionAPI, theme = testTheme): IndexViewViewer {
  return new IndexViewViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    theme,
    document,
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
}

test("diff stats color non-zero additions and deletions while leaving zero counts muted", () => {
  const colored: Array<[string, string]> = []
  const theme = {
    fg: (color: string, text: string) => {
      colored.push([color, text])
      return text
    },
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme
  const diffViewer = viewer(indexExactDocument(), {} as ExtensionAPI, theme)

  assert.equal(diffViewer.formattedStats({ files: 2, additions: 3, deletions: 4 }), "2 files +3 −4")
  assert.deepEqual(colored, [
    ["muted", "2 files"],
    ["success", "+3"],
    ["error", "−4"],
  ])

  colored.length = 0
  assert.equal(diffViewer.formattedStats({ files: 0, additions: 0, deletions: 0 }), "0 files +0 −0")
  assert.deepEqual(colored, [
    ["muted", "0 files"],
    ["muted", "+0"],
    ["muted", "−0"],
  ])
})

test("v toggles between index-exact working and staged content", () => {
  const diffViewer = viewer(indexExactDocument())

  const workingFrame = diffViewer.render(200).join("\n")
  assert.equal(diffViewer.activeScope(), "working")
  assert.match(workingFrame, /working content/u)
  assert.doesNotMatch(workingFrame, /\+staged content/u)
  assert.match(workingFrame, /Staged 2 files \+2 −2 • Working 2 files \+2 −2/u)
  assert.match(workingFrame, /◐ M mixed\.txt/u)
  assert.match(workingFrame, /↵ stage/u)

  diffViewer.handleInput("v")
  const stagedFrame = diffViewer.render(200).join("\n")

  assert.equal(diffViewer.activeScope(), "staged")
  assert.match(stagedFrame, /staged content/u)
  assert.doesNotMatch(stagedFrame, /\+working content/u)
  assert.match(stagedFrame, /↵ unstage/u)
})

test("commit flow enters staged-only review before opening the dialog", () => {
  const diffViewer = viewer(indexExactDocument())

  diffViewer.handleInput("C")

  assert.equal(diffViewer.activeScope(), "staged")
  assert.equal(diffViewer.dialogState(), "closed")
  const review = diffViewer.render(180).join("\n")
  assert.match(review, /staged content/u)
  assert.doesNotMatch(review, /\+working content/u)

  diffViewer.handleInput("C")

  assert.equal(diffViewer.dialogState(), "open")
  assert.match(diffViewer.render(180).join("\n"), /Staged: 2 files • \+2 −2/u)
})

test("normal commit with an empty index never executes git", async () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("unexpected")
    },
  } as unknown as ExtensionAPI
  const diffViewer = viewer(workingDocument(), pi)

  diffViewer.handleInput("C")
  diffViewer.handleInput("C")
  assert.equal(diffViewer.dialogState(), "open")
  diffViewer.handleInput("message")
  diffViewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(execCalls, 0)
  assert.equal(diffViewer.dialogState(), "open")
  assert.equal(diffViewer.currentError(), "No staged changes to commit")
})

test("amend remains available with an empty index when HEAD exists", async () => {
  const commands: string[] = []
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      commands.push(args.join(" "))
      if (args.join(" ") === "commit --amend -m fix") return gitResult("amended")
      return workingSnapshotResult(args, options?.cwd) ?? gitResult("", 91, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(workingDocument(), pi)

  diffViewer.handleInput("C")
  diffViewer.handleInput("C")
  diffViewer.handleInput("\x18")
  assert.match(diffViewer.render(180).join("\n"), /message\/tree amend only/u)
  diffViewer.handleInput("fix")
  diffViewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(commands.filter((command) => command === "commit --amend -m fix").length, 1)
  assert.equal(diffViewer.dialogState(), "closed")
})

test("amend is rejected when the repository has no HEAD", async () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("unexpected")
    },
  } as unknown as ExtensionAPI
  const staged = indexExactDocument().staged.files[0]
  assert.ok(staged)
  const diffViewer = viewer(workingDocument("/repo", { headState: "unborn", stagedFiles: [staged] }), pi)

  diffViewer.handleInput("C")
  diffViewer.handleInput("C")
  diffViewer.handleInput("\x18")
  diffViewer.handleInput("message")
  diffViewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(execCalls, 0)
  assert.equal(diffViewer.dialogState(), "open")
  assert.equal(diffViewer.currentError(), "There is no commit to amend")
})

test("conflicts block commit review from opening the commit dialog", () => {
  const document = buildWorkingTreeDocument({
    title: "Working tree and index",
    subtitle: "/repo (main)",
    stagedRaw: "",
    workingRaw: "",
    conflictedPaths: ["conflict.txt"],
    headState: "present",
  })
  const diffViewer = viewer(document)

  diffViewer.handleInput("C")
  diffViewer.handleInput("C")

  assert.equal(diffViewer.dialogState(), "closed")
  assert.equal(diffViewer.currentError(), "Resolve conflicts before committing")
  assert.match(diffViewer.render(160).join("\n"), /! U conflict\.txt/u)
})

test("Enter uses explicit stage-remaining and unstage operations by active view", async () => {
  const workingCommands: string[] = []
  let rootCalls = 0
  const workingPi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      workingCommands.push(command)
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return rootCalls === 1 ? gitResult(`${options?.cwd ?? "/repo"}\n`) : gitResult("", 2, "refresh failed")
      }
      if (command === "--literal-pathspecs ls-files --stage -z -- mixed.txt") return gitResult()
      if (command === "--literal-pathspecs add --all -- mixed.txt") return gitResult()
      return gitResult("", 90, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const workingViewer = viewer(indexExactDocument(), workingPi)

  workingViewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(workingCommands.filter((command) => command === "--literal-pathspecs add --all -- mixed.txt").length, 1)
  assert.ok(!workingCommands.some((command) => command.includes("diff --cached --quiet")))

  const stagedCommands: string[] = []
  rootCalls = 0
  const stagedPi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      stagedCommands.push(command)
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return rootCalls === 1 ? gitResult(`${options?.cwd ?? "/repo"}\n`) : gitResult("", 2, "refresh failed")
      }
      if (command === "--literal-pathspecs ls-files --stage -z -- mixed.txt") return gitResult()
      if (command === "--literal-pathspecs restore --staged -- mixed.txt") return gitResult()
      return gitResult("", 89, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const stagedViewer = viewer(indexExactDocument(), stagedPi)
  stagedViewer.handleInput("v")

  stagedViewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(
    stagedCommands.filter((command) => command === "--literal-pathspecs restore --staged -- mixed.txt").length,
    1,
  )
})
