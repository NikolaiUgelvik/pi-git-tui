import type { DiffFile } from "./types.js"

export type DiffDisplayRow =
  | {
      type: "hunk"
      sectionText?: string
      oldStart: number
      oldCount: number
      newStart: number
      newCount: number
    }
  | { type: "context"; marker: " "; lineNumber: number; text: string }
  | { type: "addition"; marker: "+"; lineNumber: number; text: string }
  | { type: "deletion"; marker: "-"; lineNumber: number; text: string }
  | { type: "summary"; text: string }
  | { type: "unknown"; text: string }

interface HunkState {
  oldLine: number
  newLine: number
}

interface MetadataSummary {
  binary?: string
  binaryPatch?: boolean
  newFile?: boolean
  deletedFile?: boolean
  oldMode?: string
  newMode?: string
  similarity?: string
  renameFrom?: string
  renameTo?: string
  copyFrom?: string
  copyTo?: string
  hasIndex?: boolean
}

interface MetadataLineRule {
  matches: (line: string) => boolean
  apply: (line: string, metadata: MetadataSummary) => void
}

interface FormatDiffState {
  rows: DiffDisplayRow[]
  metadata: MetadataSummary
  hunk?: HunkState
  suppressBinaryPayload: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function cleanMetadataValue(line: string, prefix: string): string {
  return line.slice(prefix.length).trim()
}

function parseHunkHeader(line: string): Extract<DiffDisplayRow, { type: "hunk" }> | undefined {
  const match = line.match(HUNK_HEADER)
  if (!match) {
    return
  }
  const oldStart = Number(match[1])
  const oldCount = match[2] === undefined ? 1 : Number(match[2])
  const newStart = Number(match[3])
  const newCount = match[4] === undefined ? 1 : Number(match[4])
  const sectionText = match[5]?.trim()
  return {
    type: "hunk",
    ...(sectionText ? { sectionText } : {}),
    oldStart,
    oldCount,
    newStart,
    newCount,
  }
}

function prefixRule(prefix: string, apply: MetadataLineRule["apply"]): MetadataLineRule {
  return { matches: (line) => line.startsWith(prefix), apply }
}

const ignoreMetadata = () => {}

const METADATA_LINE_RULES: MetadataLineRule[] = [
  prefixRule("diff --git ", ignoreMetadata),
  prefixRule("--- ", ignoreMetadata),
  prefixRule("+++ ", ignoreMetadata),
  prefixRule("index ", (_line, metadata) => {
    metadata.hasIndex = true
  }),
  prefixRule("new file mode ", (_line, metadata) => {
    metadata.newFile = true
  }),
  prefixRule("deleted file mode ", (_line, metadata) => {
    metadata.deletedFile = true
  }),
  prefixRule("old mode ", (line, metadata) => {
    metadata.oldMode = cleanMetadataValue(line, "old mode ")
  }),
  prefixRule("new mode ", (line, metadata) => {
    metadata.newMode = cleanMetadataValue(line, "new mode ")
  }),
  prefixRule("similarity index ", (line, metadata) => {
    metadata.similarity = cleanMetadataValue(line, "similarity index ")
  }),
  prefixRule("rename from ", (line, metadata) => {
    metadata.renameFrom = cleanMetadataValue(line, "rename from ")
  }),
  prefixRule("rename to ", (line, metadata) => {
    metadata.renameTo = cleanMetadataValue(line, "rename to ")
  }),
  prefixRule("copy from ", (line, metadata) => {
    metadata.copyFrom = cleanMetadataValue(line, "copy from ")
  }),
  prefixRule("copy to ", (line, metadata) => {
    metadata.copyTo = cleanMetadataValue(line, "copy to ")
  }),
  prefixRule("Binary files ", (line, metadata) => {
    metadata.binary = line.trim()
  }),
  prefixRule("GIT binary patch", (_line, metadata) => {
    metadata.binaryPatch = true
  }),
]

function updateMetadata(line: string, metadata: MetadataSummary): boolean {
  const rule = METADATA_LINE_RULES.find(({ matches }) => matches(line))
  rule?.apply(line, metadata)
  return rule !== undefined
}

function appendSimilarity(text: string, similarity?: string): string {
  return similarity ? `${text} (${similarity})` : text
}

function summaryRow(text: string | undefined): DiffDisplayRow | undefined {
  return text === undefined ? undefined : { type: "summary", text }
}

function moveSummary(kind: "Renamed" | "Copied", from?: string, to?: string, similarity?: string): string | undefined {
  return from && to ? appendSimilarity(`${kind} ${from} -> ${to}`, similarity) : undefined
}

function modeSummary(metadata: MetadataSummary): string | undefined {
  return metadata.oldMode && metadata.newMode ? `Mode changed ${metadata.oldMode} -> ${metadata.newMode}` : undefined
}

function metadataRows(metadata: MetadataSummary): DiffDisplayRow[] {
  const rows = [
    summaryRow(metadata.binary),
    summaryRow(metadata.binaryPatch ? "Binary patch" : undefined),
    summaryRow(moveSummary("Renamed", metadata.renameFrom, metadata.renameTo, metadata.similarity)),
    summaryRow(moveSummary("Copied", metadata.copyFrom, metadata.copyTo, metadata.similarity)),
    summaryRow(modeSummary(metadata)),
    summaryRow(metadata.newFile ? "New file" : undefined),
    summaryRow(metadata.deletedFile ? "Deleted file" : undefined),
  ].filter((row): row is DiffDisplayRow => row !== undefined)

  return rows.length === 0 && metadata.hasIndex ? [{ type: "summary", text: "Metadata-only diff" }] : rows
}

function hasHunkRows(rows: DiffDisplayRow[]): boolean {
  return rows.some((row) => ["hunk", "context", "addition", "deletion"].includes(row.type))
}

function hunkState(row: Extract<DiffDisplayRow, { type: "hunk" }>): HunkState {
  return { oldLine: row.oldStart, newLine: row.newStart }
}

function formatOutsideHunk(line: string, metadata: MetadataSummary): DiffDisplayRow | undefined {
  return updateMetadata(line, metadata) ? undefined : { type: "unknown", text: line }
}

function formatHunkLine(line: string, hunk: HunkState): DiffDisplayRow {
  const marker = line.at(0)
  const text = line.slice(1)
  if (line === "\\ No newline at end of file") {
    return { type: "summary", text: "No newline at end of file" }
  }
  if (marker === " ") {
    const row: DiffDisplayRow = { type: "context", marker, lineNumber: hunk.newLine, text }
    hunk.oldLine += 1
    hunk.newLine += 1
    return row
  }
  if (marker === "-") {
    const row: DiffDisplayRow = { type: "deletion", marker, lineNumber: hunk.oldLine, text }
    hunk.oldLine += 1
    return row
  }
  if (marker === "+") {
    const row: DiffDisplayRow = { type: "addition", marker, lineNumber: hunk.newLine, text }
    hunk.newLine += 1
    return row
  }
  return { type: "unknown", text: line }
}

function displayRows(rows: DiffDisplayRow[], metadata: MetadataSummary): DiffDisplayRow[] {
  if (!hasHunkRows(rows)) {
    const summaries = metadataRows(metadata)
    if (summaries.length > 0) {
      return [...summaries, ...rows.filter((row) => row.type === "unknown")]
    }
  }
  return rows.length === 0 ? [{ type: "summary", text: "No displayable diff" }] : rows
}

function appendHunkHeader(state: FormatDiffState, line: string): boolean {
  if (!line.startsWith("@@")) {
    return false
  }
  const hunkRow = parseHunkHeader(line)
  if (!hunkRow) {
    state.rows.push({ type: "unknown", text: line })
    state.hunk = undefined
    return true
  }
  state.rows.push(hunkRow)
  state.hunk = hunkState(hunkRow)
  return true
}

function appendDisplayLine(state: FormatDiffState, line: string): void {
  if (state.suppressBinaryPayload || appendHunkHeader(state, line)) {
    return
  }
  const row = state.hunk ? formatHunkLine(line, state.hunk) : formatOutsideHunk(line, state.metadata)
  state.suppressBinaryPayload = state.metadata.binaryPatch === true
  if (row) {
    state.rows.push(row)
  }
}

export function formatDiffDisplay(file: DiffFile): DiffDisplayRow[] {
  const state: FormatDiffState = {
    rows: [],
    metadata: {},
    suppressBinaryPayload: false,
  }
  for (const line of file.lines) {
    appendDisplayLine(state, line)
  }
  return displayRows(state.rows, state.metadata)
}
