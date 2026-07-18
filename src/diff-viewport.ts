import type { Theme } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"
import { normalizeTabs, sliceStyledColumns } from "./ansi-segments.js"
import { type DiffDisplayRow, formatDiffDisplay } from "./diff-display.js"
import { diffLineStyleForText } from "./diff-line-style.js"
import type { DiffFile, ThemeColor } from "./types.js"

export interface DiffViewportInput {
  file: DiffFile
  width: number
  height: number
  verticalOffset: number
  horizontalOffset: number
  theme: Theme
  displayRows?: readonly DiffDisplayRow[]
}

export interface DiffViewportResult {
  lines: string[]
  verticalOffset: number
  horizontalOffset: number
  maxVerticalOffset: number
  maxHorizontalOffset: number
  horizontallyScrollable: boolean
  gutterWidth: number
  contentWidth: number
}

interface PreparedRow {
  row: DiffDisplayRow
  gutter: string
  content: string
}

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, whole(value)))
}

function isNumberedRow(
  row: DiffDisplayRow,
): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
  return row.type === "context" || row.type === "addition" || row.type === "deletion"
}

function gutterDigits(rows: readonly DiffDisplayRow[]): number {
  return rows.reduce((width, row) => (isNumberedRow(row) ? Math.max(width, String(row.lineNumber).length) : width), 0)
}

function lineRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start}-${start + count - 1}`
}

function hunkRange(row: Extract<DiffDisplayRow, { type: "hunk" }>): string {
  return row.newCount > 0
    ? `lines ${lineRange(row.newStart, row.newCount)}`
    : `old lines ${lineRange(row.oldStart, row.oldCount)}`
}

function rowContent(row: DiffDisplayRow, file: DiffFile): string {
  if (row.type === "hunk") {
    const section = row.sectionText ? ` ${row.sectionText}` : ""
    return `@@ ${file.path} · ${hunkRange(row)} @@${section}`
  }
  return row.text
}

function prepareRows(rows: readonly DiffDisplayRow[], file: DiffFile): { rows: PreparedRow[]; gutterWidth: number } {
  const digits = gutterDigits(rows)
  const gutterWidth = digits === 0 ? 0 : digits + 4
  return {
    gutterWidth,
    rows: rows.map((row) => ({
      row,
      gutter: isNumberedRow(row)
        ? `${row.marker}${String(row.lineNumber).padStart(digits)} │ `
        : " ".repeat(gutterWidth),
      content: rowContent(row, file),
    })),
  }
}

function rowColor(row: DiffDisplayRow): ThemeColor {
  switch (row.type) {
    case "addition":
      return "toolDiffAdded"
    case "deletion":
      return "toolDiffRemoved"
    case "hunk":
      return "accent"
    case "summary":
    case "unknown":
      return "muted"
    default:
      return "toolDiffContext"
  }
}

function colorRow(row: DiffDisplayRow, line: string, theme: Theme): string {
  const probe = isNumberedRow(row) ? `${row.marker}${row.text}` : line
  const conflictRule = diffLineStyleForText(probe)
  if (conflictRule?.bold) {
    return theme.fg(conflictRule.color, theme.bold(line))
  }
  return theme.fg(rowColor(row), line)
}

function maximumContentWidth(rows: PreparedRow[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, visibleWidth(normalizeTabs(row.content))), 0)
}

function scrollbarMarker(index: number, height: number, contentHeight: number, offset: number, theme: Theme): string {
  const thumbHeight = Math.min(height, Math.max(1, Math.round((height / contentHeight) * height)))
  const remainingTrack = Math.max(0, height - thumbHeight)
  const maximumOffset = Math.max(1, contentHeight - height)
  const thumbTop = Math.round((offset / maximumOffset) * remainingTrack)
  return theme.fg("dim", index >= thumbTop && index < thumbTop + thumbHeight ? "┃" : "│")
}

export function renderDiffViewport(input: DiffViewportInput): DiffViewportResult {
  const width = whole(input.width)
  const height = whole(input.height)
  const displayRows = input.displayRows ?? formatDiffDisplay(input.file)
  const prepared = prepareRows(displayRows, input.file)
  const maxVerticalOffset = Math.max(0, prepared.rows.length - height)
  const verticalOffset = clamp(input.verticalOffset, maxVerticalOffset)
  const verticallyScrollable = height > 0 && prepared.rows.length > height
  const bodyWidth = Math.max(0, width - (verticallyScrollable ? 1 : 0))
  const visibleGutterWidth = Math.min(bodyWidth, prepared.gutterWidth)
  const contentWidth = Math.max(0, bodyWidth - visibleGutterWidth)
  const maxHorizontalOffset = Math.max(0, maximumContentWidth(prepared.rows) - contentWidth)
  const horizontalOffset = clamp(input.horizontalOffset, maxHorizontalOffset)
  const visibleRows = prepared.rows.slice(verticalOffset, verticalOffset + height)
  const lines = visibleRows.map((preparedRow, index) => {
    const gutter = sliceStyledColumns(preparedRow.gutter, 0, visibleGutterWidth, { pad: true })
    const content = sliceStyledColumns(preparedRow.content, horizontalOffset, contentWidth, { pad: true })
    const row = colorRow(preparedRow.row, gutter + content, input.theme)
    return verticallyScrollable
      ? `${row}${scrollbarMarker(index, height, prepared.rows.length, verticalOffset, input.theme)}`
      : row
  })
  while (lines.length < height) {
    lines.push(" ".repeat(width))
  }

  return {
    lines,
    verticalOffset,
    horizontalOffset,
    maxVerticalOffset,
    maxHorizontalOffset,
    horizontallyScrollable: maxHorizontalOffset > 0,
    gutterWidth: visibleGutterWidth,
    contentWidth,
  }
}
