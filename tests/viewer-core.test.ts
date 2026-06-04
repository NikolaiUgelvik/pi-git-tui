import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import type { DiffDocument } from "../src/types.js"
import { DiffViewerCore } from "../src/viewer-core.js"
import { DiffViewerOverlayBase } from "../src/viewer-overlay-base.js"

class TestViewerCore extends DiffViewerCore {
  visibleDiffRows(): number {
    return this.viewHeight()
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
