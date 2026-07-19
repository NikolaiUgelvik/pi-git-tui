import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument, buildWorkingTreeDocument, createDiffSlice } from "../src/diff-document.js"
import { renderScrollbar } from "../src/scrollbar.js"
import type { DiffDocument, DiffFile, WorkingTreeDocument } from "../src/types.js"
import { DiffViewerCore } from "../src/viewer-core.js"
import { DiffViewerFrame } from "../src/viewer-frame.js"
import { DiffViewerOverlayBase } from "../src/viewer-overlay-base.js"
import { diffHighlightTheme, stripTestAnsi } from "./helpers/diff-highlighting.js"

class TestViewerCore extends DiffViewerCore {
  visibleDiffRows(): number {
    return this.viewHeight()
  }

  helpInput(data: string): boolean {
    return this.handleHelpInput(data)
  }

  helpOverlay(): string | undefined {
    return this.helpContext
  }

  stageToggleInput(data: string): boolean {
    return this.handleFileStageToggle(data)
  }

  arrowDelta(data: string): number {
    return this.arrowScrollDelta(data)
  }

  status(): { error: string | undefined; statusMessage: string | undefined } {
    return { error: this.error, statusMessage: this.statusMessage }
  }
}

class TestFrameViewer extends DiffViewerFrame {
  treeLines(width: number, height: number): string[] {
    return this.renderTree(width, height)
  }

  diffLines(width: number, height: number, scroll = 0): string[] {
    this.diffScroll = scroll
    return this.renderDiff(width, height)
  }
}

class TestOverlayViewer extends DiffViewerOverlayBase {
  merge(baseLine: string, overlayLine: string): string {
    return this.mergeOverlayLine(baseLine, overlayLine, { overlayWidth: 4, leftPad: 2 }, 12)
  }
}

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

const emptyDocument: WorkingTreeDocument = buildWorkingTreeDocument({
  title: "Diff",
  subtitle: "Working tree",
  repositoryState: "ready",
  headState: "present",
  workingRaw: "",
  stagedRaw: "",
})

function createViewer<T extends DiffViewerCore>(
  Viewer: new (...args: ConstructorParameters<typeof DiffViewerCore>) => T,
  rows: number,
  document: DiffDocument = emptyDocument,
): T {
  return new Viewer(
    {} as ExtensionAPI,
    {} as ExtensionContext,
    theme,
    document,
    () => {},
    () => {},
    () => rows,
  )
}

function viewerForRows(rows: number): TestViewerCore {
  return createViewer(TestViewerCore, rows)
}

function overlayViewer(): TestOverlayViewer {
  return createViewer(TestOverlayViewer, 80)
}

function frameViewer(document: DiffDocument, viewerTheme: Theme = theme): TestFrameViewer {
  return new TestFrameViewer(
    {} as ExtensionAPI,
    {} as ExtensionContext,
    viewerTheme,
    document,
    () => {},
    () => {},
    () => 80,
  )
}

function file(path: string, lines: string[] = ["diff"]): DiffFile {
  return { path, status: "modified", stageState: "unstaged", lines }
}

function workingWithFiles(files: DiffFile[]): WorkingTreeDocument {
  return { ...emptyDocument, working: createDiffSlice("working", "", files) }
}

test("renderScrollbar fits lines and renders proportional scroll thumb", () => {
  assert.deepEqual(
    renderScrollbar(["abc", "def"], { width: 4, viewportHeight: 2, contentHeight: 2, scrollOffset: 0, theme }),
    ["abc ", "def "],
  )
  assert.deepEqual(
    renderScrollbar(["abc", "def", "ghi", "jkl"], {
      width: 4,
      viewportHeight: 4,
      contentHeight: 8,
      scrollOffset: 0,
      theme,
    }),
    ["abc┃", "def┃", "ghi│", "jkl│"],
  )
  assert.deepEqual(
    renderScrollbar(["abc", "def", "ghi", "jkl"], {
      width: 4,
      viewportHeight: 4,
      contentHeight: 8,
      scrollOffset: 4,
      theme,
    }),
    ["abc│", "def│", "ghi┃", "jkl┃"],
  )
  assert.deepEqual(
    renderScrollbar(["abc", "def", "ghi", "jkl"], {
      width: 4,
      viewportHeight: 4,
      contentHeight: 20,
      scrollOffset: 8,
      minWidth: 100,
      theme,
    }),
    ["abc ", "def ", "ghi ", "jkl "],
  )
})

test("frame tree renders scrollbar when rows overflow", () => {
  const viewer = frameViewer(workingWithFiles([file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")]))

  const lines = viewer.treeLines(12, 2)

  assert.equal(lines[0]?.endsWith("┃"), true)
  assert.equal(lines[1]?.endsWith("│"), true)
})

test("frame diff renders a scrollbar whenever rows overflow", () => {
  const viewer = frameViewer(workingWithFiles([file("a.ts", ["one", "two", "three", "four"])]))

  for (const width of [50, 99, 100]) {
    assert.deepEqual(
      viewer.diffLines(width, 2, 2).map((line) => line.at(-1)),
      ["│", "┃"],
    )
  }
})

test("diff body uses all terminal rows left after overlay margin and chrome", () => {
  assert.equal(viewerForRows(80).visibleDiffRows(), 71)
})

test("core help input opens and closes contextual help", () => {
  const viewer = viewerForRows(80)

  assert.equal(viewer.helpInput("?"), true)
  assert.equal(viewer.helpOverlay(), "viewer")
  assert.equal(viewer.helpInput("q"), true)
  assert.equal(viewer.helpOverlay(), undefined)
})

test("core stage toggle reports unsupported modes without mutating status", () => {
  const viewer = createViewer(
    TestViewerCore,
    80,
    buildCommitDocument({
      title: "Commit abc123",
      subtitle: "Working tree",
      raw: "diff",
      commit: { hash: "abc123", message: "historical" },
    }),
  )

  assert.equal(viewer.stageToggleInput("\n"), true)
  assert.deepEqual(viewer.status(), {
    error: "Return to the working tree with W before staging or unstaging a file.",
    statusMessage: undefined,
  })
})

test("core arrow delta maps vim-style navigation keys", () => {
  const viewer = viewerForRows(80)

  assert.equal(viewer.arrowDelta("k"), -1)
  assert.equal(viewer.arrowDelta("j"), 1)
  assert.equal(viewer.arrowDelta("x"), 0)
})

test("frame diff renders structured rows and hides raw metadata", () => {
  const viewer = frameViewer(
    workingWithFiles([
      file("src/example.ts", [
        "diff --git a/src/example.ts b/src/example.ts",
        "index 1111111..2222222 100644",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -1,2 +1,3 @@ function demo()",
        " context",
        "-old",
        "+new",
        "+extra",
      ]),
    ]),
  )

  const lines = viewer.diffLines(99, 6).map((line) => stripTestAnsi(line).trimEnd())

  assert.deepEqual(lines, [
    "     @@ src/example.ts · lines 1-3 @@ function demo()",
    " 1 │ context",
    "-2 │ old",
    "+2 │ new",
    "+3 │ extra",
    "",
  ])
  assert.equal(
    lines.some((line) => line.includes("diff --git")),
    false,
  )
})

test("frame diff scrolls by formatted rows and aligns scrollbar height", () => {
  const document = workingWithFiles([
    file("src/example.ts", [
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,1 +1,2 @@",
      " one",
      "+two",
    ]),
  ])

  const narrow = frameViewer(document).diffLines(99, 2, 10)
  assert.deepEqual(
    narrow.map((line) => line.slice(0, -1).trimEnd()),
    [" 1 │ one", "+2 │ two"],
  )
  assert.deepEqual(
    frameViewer(document)
      .diffLines(100, 2, 10)
      .map((line) => line.at(-1)),
    ["│", "┃"],
  )
})

test("frame diff preserves conflict marker styling in structured rows", () => {
  const viewer = frameViewer(
    workingWithFiles([file("conflict.ts", ["@@ -1,0 +1,1 @@", "+<<<<<<< ours"])]),
    diffHighlightTheme,
  )

  const lines = viewer.diffLines(99, 2).map((line) => line.trimEnd())

  assert.equal(stripTestAnsi(lines[1] ?? "").trimEnd(), "+1 │ <<<<<<< ours")
  assert.equal(lines[1]?.includes("\x1b[1;91;42m<<<<<<< ours"), true)
})

test("overlay merge preserves ANSI styling outside replaced columns", () => {
  const blueBaseLine = "\x1b[44mabcdefghijkl\x1b[0m"
  const redOverlay = "\x1b[31mWXYZ\x1b[0m"

  const merged = overlayViewer().merge(blueBaseLine, redOverlay)

  assert.ok(merged.includes("\x1b[44mab\x1b[0m"))
  assert.ok(merged.includes("\x1b[44mghijkl\x1b[0m"))
})
