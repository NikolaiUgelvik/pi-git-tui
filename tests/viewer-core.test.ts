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
): T {
  return new Viewer(
    {} as ExtensionAPI,
    {} as ExtensionContext,
    theme,
    emptyDocument,
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

function frameViewer(document: DiffDocument): TestFrameViewer {
  return new TestFrameViewer(
    {} as ExtensionAPI,
    {} as ExtensionContext,
    theme,
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

test("overlay merge preserves ANSI styling outside replaced columns", () => {
  const blueBaseLine = "\x1b[44mabcdefghijkl\x1b[0m"
  const redOverlay = "\x1b[31mWXYZ\x1b[0m"

  const merged = overlayViewer().merge(blueBaseLine, redOverlay)

  assert.ok(merged.includes("\x1b[44mab\x1b[0m"))
  assert.ok(merged.includes("\x1b[44mghijkl\x1b[0m"))
})
