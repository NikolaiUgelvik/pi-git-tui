import type { DiffFile } from "./types.js"

export interface TreeRow {
  label: string
  fileIndex?: number
  depth: number
  isLast: boolean
}

interface IndexedDiffFile {
  file: DiffFile
  index: number
}

function addDirectoryRows(rows: TreeRow[], seenDirs: Set<string>, dirs: string[]): void {
  let dirPath = ""
  for (const [depth, dir] of dirs.entries()) {
    dirPath = dirPath ? `${dirPath}/${dir}` : dir
    if (!seenDirs.has(dirPath)) {
      seenDirs.add(dirPath)
      rows.push({ label: dir, depth, isLast: false })
    }
  }
}

const STAGE_STATE_GLYPHS: Record<NonNullable<DiffFile["stageState"]>, string> = {
  staged: "●",
  unstaged: "○",
  mixed: "◐",
  conflicted: "!",
}

function stageStateGlyph(file: DiffFile): string {
  return file.stageState ? STAGE_STATE_GLYPHS[file.stageState] : " "
}

const STATUS_GLYPHS: Record<DiffFile["status"], string> = {
  added: "A",
  binary: "B",
  conflicted: "U",
  copied: "C",
  deleted: "D",
  modified: "M",
  renamed: "R",
}

function statusGlyph(status: DiffFile["status"]): string {
  return STATUS_GLYPHS[status]
}

function addFileRow(rows: TreeRow[], seenDirs: Set<string>, info: IndexedDiffFile): void {
  const displayParts = info.file.path.split("/").filter(Boolean)
  addDirectoryRows(rows, seenDirs, displayParts.slice(0, -1))
  rows.push({
    label: `${stageStateGlyph(info.file)} ${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}${info.file.omission ? " (omitted)" : ""}`,
    fileIndex: info.index,
    depth: Math.max(0, displayParts.length - 1),
    isLast: true,
  })
}

export function buildTreeRows(files: DiffFile[]): TreeRow[] {
  const rows: TreeRow[] = []
  const seenDirs = new Set<string>()
  const ordered = files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.index - right.index)
  for (const info of ordered) addFileRow(rows, seenDirs, info)
  return rows
}
