import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { formatDiffDisplay } from "../src/diff-display.js"
import { buildWorkingTreeDocument } from "../src/diff-document.js"
import { FilterableListState, matchesSearch, searchTokens } from "../src/filterable-list-state.js"
import { buildTreeRows } from "../src/tree.js"
import type { DiffDocument, DiffFile } from "../src/types.js"
import { DiffViewerFrame } from "../src/viewer-frame.js"
import {
  diffDisplayGutterWidth,
  MAX_RETAINED_DIFF_ROWS,
  MAX_RETAINED_DIFF_WEIGHT_BYTES,
  ViewerRenderCache,
  type ViewerRenderCacheStats,
} from "../src/viewer-render-cache.js"

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

function diffFile(path: string, lineCount: number): DiffFile {
  const lines = Array.from({ length: lineCount }, (_, index) => ` line ${index + 1}`)
  return {
    path,
    status: "modified",
    staged: false,
    lines: [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lineCount} +1,${lineCount} @@`,
      ...lines,
    ],
  }
}

function document(files: DiffFile[]): DiffDocument {
  return buildWorkingTreeDocument({
    title: "Diff",
    subtitle: "Working tree",
    headState: "present",
    stagedRaw: "",
    workingRaw: "",
    workingOmittedFiles: files,
  })
}

class InstrumentedFrameViewer extends DiffViewerFrame {
  scrollBy(delta: number): void {
    this.scrollDiff(delta)
  }

  moveBy(delta: number): void {
    this.moveFile(delta)
  }

  treeLines(width: number, height: number): string[] {
    return this.renderTree(width, height)
  }

  stats(): ViewerRenderCacheStats {
    return this.renderCacheStats()
  }

  replace(files: DiffFile[]): void {
    this.documentState.replaceDocument(
      { kind: "working", cwd: "/repo" },
      document(files),
      this.documentState.captureSelection(),
    )
  }

  selected(): DiffFile | undefined {
    return this.files[this.selectedFileIndex]
  }
}

function frameViewer(files: DiffFile[]): InstrumentedFrameViewer {
  return new InstrumentedFrameViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    theme,
    document(files),
    () => {},
    () => {},
    () => 40,
  )
}

test("selected-file display cache preserves rows and gutter across repeated scrolling", () => {
  const file = diffFile("src/large.ts", 1_000)
  const expectedRows = formatDiffDisplay(file)
  const cache = new ViewerRenderCache([file])

  const first = cache.selectedFileDisplay(0)

  assert.ok(first)
  assert.deepEqual(first.rows, expectedRows)
  assert.equal(first.gutterWidth, diffDisplayGutterWidth(expectedRows))
  assert.equal(Object.isFrozen(first.rows), true)
  assert.equal(Object.isFrozen(first.rows[0]), true)
  for (let scroll = 0; scroll < 200; scroll++) {
    assert.strictEqual(cache.selectedFileDisplay(0), first)
    assert.deepEqual(first.rows.slice(scroll, scroll + 20), expectedRows.slice(scroll, scroll + 20))
  }
  assert.equal(cache.stats().selectedFileDisplayBuilds, 1)
})

test("oversized selected-file displays are never retained", () => {
  const file = diffFile("historical-huge.txt", MAX_RETAINED_DIFF_ROWS + 1)
  const cache = new ViewerRenderCache([file])

  const first = cache.selectedFileDisplay(0)
  const second = cache.selectedFileDisplay(0)

  assert.ok(first)
  assert.ok(second)
  assert.notStrictEqual(first, second)
  assert.equal(cache.stats().selectedFileDisplayBuilds, 2)
  assert.equal(cache.stats().selectedFileDisplaySkips, 2)
  assert.equal(cache.stats().retainedSelectedFileRows, 0)
  assert.equal(cache.stats().retainedSelectedFileWeightBytes, 0)
})

test("selected-file display cache reuses bounded LRU entries and invalidates on replacement", () => {
  const firstFile = diffFile("a.ts", 10)
  const secondFile = diffFile("b.ts", 20)
  const cache = new ViewerRenderCache([firstFile, secondFile])

  const firstA = cache.selectedFileDisplay(0)
  cache.selectedFileDisplay(1)
  const secondA = cache.selectedFileDisplay(0)

  assert.strictEqual(firstA, secondA)
  assert.equal(cache.stats().selectedFileDisplayBuilds, 2)

  const replacement = diffFile("replacement.ts", 30)
  cache.replaceDocument([replacement])
  const replacementDisplay = cache.selectedFileDisplay(0)

  assert.deepEqual(replacementDisplay?.rows, formatDiffDisplay(replacement))
  const stats = cache.stats()
  assert.equal(stats.documentVersion, 1)
  assert.equal(stats.selectedFileDisplayBuilds, 3)
  assert.equal(stats.selectedFileDisplaySkips, 0)
  assert.equal(stats.retainedSelectedFileRows, replacementDisplay?.rows.length)
  assert.equal(stats.retainedSelectedFileWeightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES, true)
  assert.equal(stats.treeBuilds, 0)
})

test("selected-file LRU evicts the oldest cumulative entry within row and byte caps", () => {
  const files = Array.from({ length: 6 }, (_, index) => diffFile(`medium-${index}.ts`, 9_000))
  const cache = new ViewerRenderCache(files)
  const firstZero = cache.selectedFileDisplay(0)
  const firstOne = cache.selectedFileDisplay(1)
  cache.selectedFileDisplay(2)
  cache.selectedFileDisplay(3)
  assert.strictEqual(cache.selectedFileDisplay(0), firstZero)
  cache.selectedFileDisplay(4)
  cache.selectedFileDisplay(5)

  assert.strictEqual(cache.selectedFileDisplay(0), firstZero)
  assert.notStrictEqual(cache.selectedFileDisplay(1), firstOne)
  const stats = cache.stats()
  assert.equal(stats.retainedSelectedFileRows <= MAX_RETAINED_DIFF_ROWS, true)
  assert.equal(stats.retainedSelectedFileWeightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES, true)
  assert.equal(stats.selectedFileDisplayAccesses, 9)
  assert.equal(stats.selectedFileDisplayHits, 2)
  assert.equal(stats.selectedFileDisplayMisses, 7)
})

test("same-reference document replacement preserves expensive derivations", () => {
  const files = [diffFile("same.ts", 100)]
  const cache = new ViewerRenderCache(files)
  const display = cache.selectedFileDisplay(0)
  const tree = cache.treeRows()
  const before = cache.stats()

  cache.replaceDocument(files)

  assert.strictEqual(cache.selectedFileDisplay(0), display)
  assert.strictEqual(cache.treeRows(), tree)
  const after = cache.stats()
  assert.equal(after.documentVersion, before.documentVersion)
  assert.equal(after.selectedFileDisplayBuilds, before.selectedFileDisplayBuilds)
  assert.equal(after.selectedFileDisplayMisses, before.selectedFileDisplayMisses)
  assert.equal(after.selectedFileDisplayHits, before.selectedFileDisplayHits + 1)
  assert.equal(after.treeBuilds, before.treeBuilds)
})

test("tree rows preserve distinct logical changes that share one path", () => {
  const deleted: DiffFile = { path: "same.txt", status: "deleted", staged: true, lines: [] }
  const recreated: DiffFile = {
    path: "same.txt",
    status: "added",
    staged: false,
    untracked: true,
    untrackedRole: "replacement",
    lines: [],
  }
  const cache = new ViewerRenderCache([deleted, recreated])

  assert.deepEqual(
    cache.treeRows().flatMap((row) => (row.fileIndex === undefined ? [] : [row.fileIndex])),
    [0, 1],
  )
  assert.deepEqual(cache.treeFileOrder(), [0, 1])
})

test("document replacement preserves the selected logical duplicate path", () => {
  const deleted: DiffFile = { path: "same.txt", status: "deleted", staged: true, lines: [] }
  const recreated: DiffFile = {
    path: "same.txt",
    status: "added",
    staged: false,
    untracked: true,
    untrackedRole: "replacement",
    lines: [],
  }
  const viewer = frameViewer([deleted, recreated])
  viewer.moveBy(1)
  assert.equal(viewer.selected()?.untrackedRole, "replacement")

  viewer.replace([{ ...deleted }, { ...recreated }])

  assert.equal(viewer.selected()?.status, "added")
  assert.equal(viewer.selected()?.untrackedRole, "replacement")
})

test("tree cache preserves rows, order, and lookups without rebuilding during navigation", () => {
  const files = [
    diffFile("z-last.ts", 1),
    diffFile("src/b.ts", 1),
    diffFile("src/nested/a.ts", 1),
    diffFile("a-first.ts", 1),
  ]
  const expectedRows = buildTreeRows(files)
  const expectedOrder = expectedRows.flatMap((row) => (row.fileIndex === undefined ? [] : [row.fileIndex]))
  const cache = new ViewerRenderCache(files)

  assert.deepEqual(cache.treeRows(), expectedRows)
  assert.deepEqual(cache.treeFileOrder(), expectedOrder)
  assert.equal(Object.isFrozen(cache.treeRows()), true)
  assert.equal(cache.fileIndexForPath("src/b.ts"), 1)
  assert.equal(
    cache.treeRowIndex(2),
    expectedRows.findIndex((row) => row.fileIndex === 2),
  )

  let selectedFileIndex = expectedOrder[0] ?? 0
  for (let step = 0; step < 1_000; step++) {
    const position = cache.treeFileOrderIndex(selectedFileIndex) ?? 0
    selectedFileIndex = expectedOrder[(position + 1) % expectedOrder.length] ?? selectedFileIndex
    assert.notEqual(cache.treeRowIndex(selectedFileIndex), undefined)
  }
  assert.equal(cache.stats().treeBuilds, 1)

  cache.replaceDocument([diffFile("new.ts", 1)])
  assert.deepEqual(cache.treeFileOrder(), [0])
  assert.equal(cache.stats().treeBuilds, 2)
})

test("filtered list retains one immutable snapshot across repeated navigation", () => {
  const sourceItems = Array.from({ length: 1_000 }, (_, index) =>
    index % 5 === 0 ? `matching item ${index}` : `other item ${index}`,
  )
  const expected = sourceItems.filter((item) => matchesSearch(item, searchTokens("matching")))
  const state = new FilterableListState(sourceItems, (item) => item)
  state.searchQuery = "matching"

  const first = state.filteredItems
  sourceItems.push("matching external mutation")
  for (let step = 0; step < 1_000; step++) {
    state.moveSelection("j")
    state.visibleItems(20)
    assert.strictEqual(state.filteredItems, first)
  }

  assert.deepEqual(first, expected)
  assert.equal(Object.isFrozen(first), true)
  assert.deepEqual(state.cacheStats(), { itemsVersion: 0, filteredSnapshotBuilds: 1 })

  state.searchQuery = "other"
  assert.equal(state.filteredCount, 800)
  state.items = ["replacement matching", "replacement other"]
  assert.deepEqual(state.filteredItems, ["replacement other"])
  assert.deepEqual(state.cacheStats(), { itemsVersion: 1, filteredSnapshotBuilds: 3 })
})

test("viewer scrolling reuses selected display derivation and returns identical output", () => {
  const viewer = frameViewer([diffFile("large.ts", 1_000)])
  const baseline = viewer.render(140)

  for (let step = 0; step < 100; step++) {
    viewer.scrollBy(1)
    viewer.render(140)
  }
  viewer.scrollBy(-10_000)

  assert.deepEqual(viewer.render(140), baseline)
  const stats = viewer.stats()
  assert.equal(stats.documentVersion, 1)
  assert.equal(stats.selectedFileDisplayBuilds, 1)
  assert.equal(stats.selectedFileDisplaySkips, 0)
  assert.equal(stats.retainedSelectedFileRows, 1_001)
  assert.equal(stats.retainedSelectedFileWeightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES, true)
  assert.equal(stats.treeBuilds, 1)
})

test("viewer file navigation reuses tree derivation and returns identical output", () => {
  const files = Array.from({ length: 200 }, (_, index) => diffFile(`src/file-${String(index).padStart(3, "0")}.ts`, 1))
  const viewer = frameViewer(files)
  const baseline = viewer.treeLines(40, 15)

  for (let step = 0; step < 100; step++) {
    viewer.moveBy(1)
    viewer.treeLines(40, 15)
  }
  for (let step = 0; step < 100; step++) {
    viewer.moveBy(-1)
    viewer.treeLines(40, 15)
  }

  assert.deepEqual(viewer.treeLines(40, 15), baseline)
  assert.equal(viewer.stats().treeBuilds, 1)
})
