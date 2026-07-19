import type { DiffDisplayRow } from "./diff-display.js"
import type { PreparedDiffDisplay } from "./diff-presentation.js"
import { buildTreeRows, type TreeRow } from "./tree.js"
import type { DiffFile } from "./types.js"

export type DiffPresenter = (file: DiffFile) => PreparedDiffDisplay
export type SelectedFileDisplay = PreparedDiffDisplay

export const MAX_RETAINED_DIFF_ROWS = 50_000
export const MAX_RETAINED_DIFF_WEIGHT_BYTES = 8 * 1024 * 1024
export const MAX_CURRENT_DIFF_ROWS = 100_000
export const MAX_CURRENT_DIFF_WEIGHT_BYTES = 64 * 1024 * 1024

export interface ViewerRenderCacheStats {
  readonly documentVersion: number
  readonly presentationGeneration: number
  readonly selectedFileDisplayAccesses: number
  readonly selectedFileDisplayHits: number
  readonly selectedFileDisplayMisses: number
  readonly selectedFileDisplayBuilds: number
  readonly selectedFileDisplaySkips: number
  readonly selectedFileDisplayPins: number
  readonly retainedSelectedFileRows: number
  readonly retainedSelectedFileWeightBytes: number
  readonly currentSelectedFileRows: number
  readonly currentSelectedFileWeightBytes: number
  readonly richSelectedFileDisplayBuilds: number
  readonly plainSelectedFileDisplayBuilds: number
  readonly syntaxHighlighterCalls: number
  readonly themeInvalidations: number
  readonly treeBuilds: number
}

interface VersionedSelectedFileDisplay extends PreparedDiffDisplay {
  readonly documentVersion: number
  readonly presentationGeneration: number
  readonly fileIndex: number
}

interface TreeSnapshot {
  readonly documentVersion: number
  readonly rows: readonly TreeRow[]
  readonly fileOrder: readonly number[]
  readonly fileOrderIndex: ReadonlyMap<number, number>
  readonly rowIndex: ReadonlyMap<number, number>
  readonly fileIndexByPath: ReadonlyMap<string, number>
}

function immutableRows<T extends object>(rows: T[]): readonly T[] {
  for (const row of rows) Object.freeze(row)
  return Object.freeze(rows)
}

function isNumberedDiffRow(
  row: DiffDisplayRow,
): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
  return row.type === "context" || row.type === "addition" || row.type === "deletion"
}

export function diffDisplayGutterWidth(rows: readonly DiffDisplayRow[]): number {
  return rows.reduce((width, row) => {
    if (!isNumberedDiffRow(row)) return width
    return Math.max(width, String(row.lineNumber).length)
  }, 0)
}

/** Holds bounded presentation and tree derivations for one immutable document reference. */
export class ViewerRenderCache {
  private documentVersion = 0
  private presentationGeneration = 0
  private selectedFileDisplayAccesses = 0
  private selectedFileDisplayHits = 0
  private selectedFileDisplayMisses = 0
  private selectedFileDisplayBuilds = 0
  private selectedFileDisplaySkips = 0
  private selectedFileDisplayPins = 0
  private richSelectedFileDisplayBuilds = 0
  private plainSelectedFileDisplayBuilds = 0
  private syntaxHighlighterCalls = 0
  private themeInvalidations = 0
  private treeBuilds = 0
  private readonly selectedFileDisplaySnapshots = new Map<number, VersionedSelectedFileDisplay>()
  private retainedDisplayRows = 0
  private retainedDisplayWeightBytes = 0
  private currentDisplay: VersionedSelectedFileDisplay | undefined
  private treeSnapshotValue: TreeSnapshot | undefined

  constructor(
    private files: readonly DiffFile[],
    private readonly presenter: DiffPresenter,
  ) {}

  replaceDocument(files: readonly DiffFile[]): void {
    if (files === this.files) return
    this.files = files
    this.documentVersion++
    this.clearPresentations()
    this.treeSnapshotValue = undefined
  }

  invalidate(): void {
    this.documentVersion++
    this.clearPresentations()
    this.treeSnapshotValue = undefined
  }

  invalidatePresentation(): void {
    this.presentationGeneration++
    this.themeInvalidations++
    this.clearPresentations()
  }

  selectedFileDisplay(fileIndex: number): SelectedFileDisplay | undefined {
    const file = this.files[fileIndex]
    if (!file) return
    this.selectedFileDisplayAccesses++
    if (this.currentDisplay && this.currentDisplay.fileIndex !== fileIndex) this.currentDisplay = undefined

    const current = this.currentDisplay
    if (this.isCurrent(current, fileIndex)) {
      this.selectedFileDisplayHits++
      return current
    }
    const cached = this.selectedFileDisplaySnapshots.get(fileIndex)
    if (this.isCurrent(cached, fileIndex)) {
      this.selectedFileDisplayHits++
      this.selectedFileDisplaySnapshots.delete(fileIndex)
      this.selectedFileDisplaySnapshots.set(fileIndex, cached)
      return cached
    }

    this.selectedFileDisplayMisses++
    const presentation = this.presenter(file)
    const snapshot: VersionedSelectedFileDisplay = Object.freeze({
      ...presentation,
      documentVersion: this.documentVersion,
      presentationGeneration: this.presentationGeneration,
      fileIndex,
    })
    this.selectedFileDisplayBuilds++
    this.syntaxHighlighterCalls += presentation.highlighterCalls
    if (presentation.mode === "rich") this.richSelectedFileDisplayBuilds++
    else this.plainSelectedFileDisplayBuilds++

    if (this.fitsNormalTier(snapshot)) this.retainSelectedFileDisplay(snapshot)
    else {
      this.selectedFileDisplaySkips++
      if (this.fitsCurrentTier(snapshot)) {
        this.currentDisplay = snapshot
        this.selectedFileDisplayPins++
      }
    }
    return snapshot
  }

  treeRows(): readonly TreeRow[] {
    return this.treeSnapshot().rows
  }

  treeFileOrder(): readonly number[] {
    return this.treeSnapshot().fileOrder
  }

  treeFileOrderIndex(fileIndex: number): number | undefined {
    return this.treeSnapshot().fileOrderIndex.get(fileIndex)
  }

  treeRowIndex(fileIndex: number): number | undefined {
    return this.treeSnapshot().rowIndex.get(fileIndex)
  }

  fileIndexForPath(path: string): number | undefined {
    return this.treeSnapshot().fileIndexByPath.get(path)
  }

  stats(): ViewerRenderCacheStats {
    return {
      documentVersion: this.documentVersion,
      presentationGeneration: this.presentationGeneration,
      selectedFileDisplayAccesses: this.selectedFileDisplayAccesses,
      selectedFileDisplayHits: this.selectedFileDisplayHits,
      selectedFileDisplayMisses: this.selectedFileDisplayMisses,
      selectedFileDisplayBuilds: this.selectedFileDisplayBuilds,
      selectedFileDisplaySkips: this.selectedFileDisplaySkips,
      selectedFileDisplayPins: this.selectedFileDisplayPins,
      retainedSelectedFileRows: this.retainedDisplayRows,
      retainedSelectedFileWeightBytes: this.retainedDisplayWeightBytes,
      currentSelectedFileRows: this.currentDisplay?.rows.length ?? 0,
      currentSelectedFileWeightBytes: this.currentDisplay?.weightBytes ?? 0,
      richSelectedFileDisplayBuilds: this.richSelectedFileDisplayBuilds,
      plainSelectedFileDisplayBuilds: this.plainSelectedFileDisplayBuilds,
      syntaxHighlighterCalls: this.syntaxHighlighterCalls,
      themeInvalidations: this.themeInvalidations,
      treeBuilds: this.treeBuilds,
    }
  }

  private isCurrent(
    snapshot: VersionedSelectedFileDisplay | undefined,
    fileIndex: number,
  ): snapshot is VersionedSelectedFileDisplay {
    return (
      snapshot?.documentVersion === this.documentVersion &&
      snapshot.presentationGeneration === this.presentationGeneration &&
      snapshot.fileIndex === fileIndex
    )
  }

  private fitsNormalTier(snapshot: VersionedSelectedFileDisplay): boolean {
    return snapshot.rows.length <= MAX_RETAINED_DIFF_ROWS && snapshot.weightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES
  }

  private fitsCurrentTier(snapshot: VersionedSelectedFileDisplay): boolean {
    return snapshot.rows.length <= MAX_CURRENT_DIFF_ROWS && snapshot.weightBytes <= MAX_CURRENT_DIFF_WEIGHT_BYTES
  }

  private clearPresentations(): void {
    this.selectedFileDisplaySnapshots.clear()
    this.retainedDisplayRows = 0
    this.retainedDisplayWeightBytes = 0
    this.currentDisplay = undefined
  }

  private retainSelectedFileDisplay(snapshot: VersionedSelectedFileDisplay): void {
    while (
      this.selectedFileDisplaySnapshots.size > 0 &&
      (this.retainedDisplayRows + snapshot.rows.length > MAX_RETAINED_DIFF_ROWS ||
        this.retainedDisplayWeightBytes + snapshot.weightBytes > MAX_RETAINED_DIFF_WEIGHT_BYTES)
    ) {
      const oldestIndex = this.selectedFileDisplaySnapshots.keys().next().value
      if (oldestIndex === undefined) break
      const oldest = this.selectedFileDisplaySnapshots.get(oldestIndex)
      this.selectedFileDisplaySnapshots.delete(oldestIndex)
      this.retainedDisplayRows -= oldest?.rows.length ?? 0
      this.retainedDisplayWeightBytes -= oldest?.weightBytes ?? 0
    }
    this.selectedFileDisplaySnapshots.set(snapshot.fileIndex, snapshot)
    this.retainedDisplayRows += snapshot.rows.length
    this.retainedDisplayWeightBytes += snapshot.weightBytes
  }

  private treeSnapshot(): TreeSnapshot {
    const cached = this.treeSnapshotValue
    if (cached?.documentVersion === this.documentVersion) return cached
    const rows = immutableRows(buildTreeRows([...this.files]))
    const fileOrder: number[] = []
    const fileOrderIndex = new Map<number, number>()
    const rowIndex = new Map<number, number>()
    const fileIndexByPath = new Map<string, number>()
    for (const [index, file] of this.files.entries()) {
      if (!fileIndexByPath.has(file.path)) fileIndexByPath.set(file.path, index)
    }
    for (const [index, row] of rows.entries()) {
      if (row.fileIndex === undefined) continue
      rowIndex.set(row.fileIndex, index)
      fileOrderIndex.set(row.fileIndex, fileOrder.length)
      fileOrder.push(row.fileIndex)
    }
    const snapshot: TreeSnapshot = {
      documentVersion: this.documentVersion,
      rows,
      fileOrder: Object.freeze(fileOrder),
      fileOrderIndex,
      rowIndex,
      fileIndexByPath,
    }
    this.treeSnapshotValue = snapshot
    this.treeBuilds++
    return snapshot
  }
}
