import { type DiffDisplayRow, formatDiffDisplay } from "./diff-display.js"
import { buildTreeRows, type TreeRow } from "./tree.js"
import type { DiffFile } from "./types.js"

export interface SelectedFileDisplay {
  readonly rows: readonly DiffDisplayRow[]
  readonly gutterWidth: number
}

export const MAX_RETAINED_DIFF_ROWS = 50_000
export const MAX_RETAINED_DIFF_WEIGHT_BYTES = 8 * 1024 * 1024

export interface ViewerRenderCacheStats {
  readonly documentVersion: number
  readonly selectedFileDisplayAccesses: number
  readonly selectedFileDisplayHits: number
  readonly selectedFileDisplayMisses: number
  readonly selectedFileDisplayBuilds: number
  readonly selectedFileDisplaySkips: number
  readonly retainedSelectedFileRows: number
  readonly retainedSelectedFileWeightBytes: number
  readonly treeBuilds: number
}

interface VersionedSelectedFileDisplay extends SelectedFileDisplay {
  readonly documentVersion: number
  readonly fileIndex: number
  readonly weightBytes: number
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
  for (const row of rows) {
    Object.freeze(row)
  }
  return Object.freeze(rows)
}

function isNumberedDiffRow(
  row: DiffDisplayRow,
): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
  return row.type === "context" || row.type === "addition" || row.type === "deletion"
}

function displayRowWeight(row: DiffDisplayRow): number {
  const text = "text" in row ? row.text : (row.sectionText ?? "")
  return 128 + Buffer.byteLength(text, "utf8")
}

function displayWeight(rows: readonly DiffDisplayRow[]): number {
  return rows.reduce((total, row) => total + displayRowWeight(row), 0)
}

export function diffDisplayGutterWidth(rows: readonly DiffDisplayRow[]): number {
  return rows.reduce((width, row) => {
    if (!isNumberedDiffRow(row)) {
      return width
    }
    return Math.max(width, String(row.lineNumber).length)
  }, 0)
}

/**
 * Holds one document generation of viewer derivations.
 *
 * Diff documents are treated as immutable between replaceDocument() calls.
 * Each replacement or explicit invalidation advances the version and drops the
 * row/byte-bounded selected-file LRU and tree snapshot, so historical documents
 * cannot accumulate in the cache.
 */
export class ViewerRenderCache {
  private documentVersion = 0
  private selectedFileDisplayAccesses = 0
  private selectedFileDisplayHits = 0
  private selectedFileDisplayMisses = 0
  private selectedFileDisplayBuilds = 0
  private selectedFileDisplaySkips = 0
  private treeBuilds = 0
  private readonly selectedFileDisplaySnapshots = new Map<number, VersionedSelectedFileDisplay>()
  private retainedDisplayRows = 0
  private retainedDisplayWeightBytes = 0
  private treeSnapshotValue: TreeSnapshot | undefined

  constructor(private files: readonly DiffFile[]) {}

  replaceDocument(files: readonly DiffFile[]): void {
    if (files === this.files) return
    this.files = files
    this.invalidate()
  }

  invalidate(): void {
    this.documentVersion++
    this.selectedFileDisplaySnapshots.clear()
    this.retainedDisplayRows = 0
    this.retainedDisplayWeightBytes = 0
    this.treeSnapshotValue = undefined
  }

  selectedFileDisplay(fileIndex: number): SelectedFileDisplay | undefined {
    const file = this.files[fileIndex]
    if (!file) {
      return
    }
    this.selectedFileDisplayAccesses++
    const cached = this.selectedFileDisplaySnapshots.get(fileIndex)
    if (cached?.documentVersion === this.documentVersion) {
      this.selectedFileDisplayHits++
      this.selectedFileDisplaySnapshots.delete(fileIndex)
      this.selectedFileDisplaySnapshots.set(fileIndex, cached)
      return cached
    }

    this.selectedFileDisplayMisses++
    const formattedRows = formatDiffDisplay(file)
    const weightBytes = displayWeight(formattedRows)
    const retain = formattedRows.length <= MAX_RETAINED_DIFF_ROWS && weightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES
    const rows = retain ? immutableRows(formattedRows) : formattedRows
    const snapshot: VersionedSelectedFileDisplay = Object.freeze({
      documentVersion: this.documentVersion,
      fileIndex,
      rows,
      gutterWidth: diffDisplayGutterWidth(rows),
      weightBytes,
    })
    this.selectedFileDisplayBuilds++
    if (retain) this.retainSelectedFileDisplay(snapshot)
    else this.selectedFileDisplaySkips++
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
      selectedFileDisplayAccesses: this.selectedFileDisplayAccesses,
      selectedFileDisplayHits: this.selectedFileDisplayHits,
      selectedFileDisplayMisses: this.selectedFileDisplayMisses,
      selectedFileDisplayBuilds: this.selectedFileDisplayBuilds,
      selectedFileDisplaySkips: this.selectedFileDisplaySkips,
      retainedSelectedFileRows: this.retainedDisplayRows,
      retainedSelectedFileWeightBytes: this.retainedDisplayWeightBytes,
      treeBuilds: this.treeBuilds,
    }
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
    if (cached?.documentVersion === this.documentVersion) {
      return cached
    }

    const rows = immutableRows(buildTreeRows([...this.files]))
    const fileOrder: number[] = []
    const fileOrderIndex = new Map<number, number>()
    const rowIndex = new Map<number, number>()
    const fileIndexByPath = new Map<string, number>()

    for (const [index, file] of this.files.entries()) {
      if (!fileIndexByPath.has(file.path)) {
        fileIndexByPath.set(file.path, index)
      }
    }
    for (const [index, row] of rows.entries()) {
      if (row.fileIndex === undefined) {
        continue
      }
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
