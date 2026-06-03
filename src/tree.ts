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

function stagedGlyph(file: DiffFile): string {
  return file.staged ? "●" : " "
}

function statusGlyph(status: DiffFile["status"]): string {
  switch (status) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "copied":
      return "C"
    case "binary":
      return "B"
    case "modified":
      return "M"
  }
}

function addFileRow(rows: TreeRow[], seenDirs: Set<string>, info: IndexedDiffFile): void {
  const displayParts = info.file.path.split("/").filter(Boolean)
  addDirectoryRows(rows, seenDirs, displayParts.slice(0, -1))
  rows.push({
    label: `${stagedGlyph(info.file)} ${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}`,
    fileIndex: info.index,
    depth: Math.max(0, displayParts.length - 1),
    isLast: true,
  })
}

export function buildTreeRows(files: DiffFile[]): TreeRow[] {
  const rows: TreeRow[] = []
  const seenDirs = new Set<string>()
  const byPath = new Map(files.map((file, index) => [file.path, { file, index }]))
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const info = byPath.get(file.path)
    if (info) {
      addFileRow(rows, seenDirs, info)
    }
  }
  return rows
}
