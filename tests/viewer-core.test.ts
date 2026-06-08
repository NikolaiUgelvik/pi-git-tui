import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { renderScrollbar } from "../src/scrollbar.js"
import type { DiffDocument } from "../src/types.js"
import { DiffViewerCore } from "../src/viewer-core.js"
import { DiffViewerFrame } from "../src/viewer-frame.js"
import { DiffViewerOverlayBase } from "../src/viewer-overlay-base.js"

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

const emptyDocument: DiffDocument = {
  mode: "working",
  title: "Diff",
  subtitle: "Working tree",
  raw: "",
  files: [],
}

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

function file(path: string, lines: string[] = ["diff"]): DiffDocument["files"][number] {
  return { path, status: "modified", staged: false, lines }
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
  const viewer = frameViewer({ ...emptyDocument, files: [file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")] })

  const lines = viewer.treeLines(12, 2)

  assert.equal(lines[0]?.endsWith("┃"), true)
  assert.equal(lines[1]?.endsWith("│"), true)
})

test("frame diff renders scrollbar only when pane is wide enough", () => {
  const viewer = frameViewer({ ...emptyDocument, files: [file("a.ts", ["one", "two", "three", "four"])] })

  assert.deepEqual(
    viewer.diffLines(100, 2, 2).map((line) => line.at(-1)),
    ["│", "┃"],
  )
  assert.equal(
    viewer.diffLines(99, 2, 2).some((line) => line.includes("│") || line.includes("┃")),
    false,
  )
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
  const viewer = createViewer(TestViewerCore, 80, {
    ...emptyDocument,
    mode: "commit",
    files: [file("src/example.ts")],
  })

  assert.equal(viewer.stageToggleInput("\n"), true)
  assert.deepEqual(viewer.status(), {
    error: "Staging is only available in the working tree",
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
  const viewer = frameViewer({
    ...emptyDocument,
    files: [
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
    ],
  })

  const lines = viewer.diffLines(99, 6).map((line) => line.trimEnd())

  assert.deepEqual(lines, [
    "@@ src/example.ts · lines 1-3 @@ function demo()",
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
  const document = {
    ...emptyDocument,
    files: [
      file("src/example.ts", [
        "diff --git a/src/example.ts b/src/example.ts",
        "index 1111111..2222222 100644",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -1,1 +1,2 @@",
        " one",
        "+two",
      ]),
    ],
  }

  assert.deepEqual(
    frameViewer(document)
      .diffLines(99, 2, 10)
      .map((line) => line.trimEnd()),
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
  const styledTheme = {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => `<b>${text}</b>`,
  } as Theme
  const viewer = frameViewer(
    {
      ...emptyDocument,
      files: [file("conflict.ts", ["@@ -1,0 +1,1 @@", "+<<<<<<< ours"])],
    },
    styledTheme,
  )

  const lines = viewer.diffLines(99, 2).map((line) => line.trimEnd())

  assert.equal(lines[1], "<error><b>+1 │ <<<<<<< ours</b></error>")
})

test("overlay merge blanks styled base outside replaced columns", () => {
  const blueBaseLine = "\x1b[44mabcdefghijkl\x1b[0m"
  const redOverlay = "\x1b[31mWXYZ\x1b[0m"

  const merged = overlayViewer().merge(blueBaseLine, redOverlay)

  assert.ok(merged.includes("\x1b[44m  \x1b[0m"))
  assert.ok(merged.includes("\x1b[44m      \x1b[0m"))
  assert.equal(merged.includes("ab"), false)
  assert.equal(merged.includes("ghijkl"), false)
})

test("overlay merge preserves styled outer frame borders", () => {
  const baseLine = "\x1b[34m│\x1b[0m\x1b[44mabcdefghij\x1b[0m\x1b[34m│\x1b[0m"
  const redOverlay = "\x1b[31mWXYZ\x1b[0m"

  const merged = overlayViewer().merge(baseLine, redOverlay)

  assert.ok(merged.includes("\x1b[34m│\x1b[0m"))
  assert.ok(merged.includes("\x1b[31mWXYZ\x1b[0m"))
  assert.equal(merged.includes("ab"), false)
  assert.equal(merged.includes("ghij"), false)
})
