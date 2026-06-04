import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import type { DiffDocument } from "../src/types.js"
import { DiffViewerCore } from "../src/viewer-core.js"

class TestViewerCore extends DiffViewerCore {
  visibleDiffRows(): number {
    return this.viewHeight()
  }
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

const emptyDocument: DiffDocument = {
  mode: "working",
  title: "Diff",
  subtitle: "Working tree",
  raw: "",
  files: [],
}

function viewerForRows(rows: number): TestViewerCore {
  return new TestViewerCore(
    {} as ExtensionAPI,
    {} as ExtensionContext,
    theme,
    emptyDocument,
    () => {},
    () => {},
    () => rows,
  )
}

test("diff body uses all terminal rows left after overlay margin and chrome", () => {
  assert.equal(viewerForRows(80).visibleDiffRows(), 71)
})
