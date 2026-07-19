import type { Theme } from "@earendil-works/pi-coding-agent"
import {
  normalizeDiffText,
  prepareStyledColumns,
  type StyledColumns,
  type StyledSpanDecoration,
  stripTrustedSgr,
} from "./ansi-segments.js"
import { blendedBackgroundAnsi } from "./ansi-sgr.js"
import { type DiffDisplayRow, formatDiffDisplay } from "./diff-display.js"
import { planIntralineChanges } from "./diff-intraline.js"
import { diffLineStyleForText } from "./diff-line-style.js"
import { piSyntaxHighlighting, planDiffSyntax, type SyntaxHighlighting } from "./diff-syntax.js"
import type { DiffFile, ThemeColor } from "./types.js"

export interface PreparedDiffRow {
  readonly semantic: DiffDisplayRow
  readonly gutter: StyledColumns
  readonly content: StyledColumns
}

export interface PreparedDiffDisplay {
  readonly rows: readonly PreparedDiffRow[]
  /** Total terminal cells, including marker, digits, separator, and spaces. */
  readonly gutterWidth: number
  readonly maxContentWidth: number
  readonly weightBytes: number
  readonly mode: "rich" | "plain"
  readonly highlighterCalls: number
}

type ThemeBackground = Parameters<Theme["bg"]>[0]
type ThemeWithAnsi = Theme & {
  getFgAnsi?: (color: ThemeColor) => string
  getBgAnsi?: (color: ThemeBackground) => string
}

function ansiPrefix(styled: string, marker: string): string {
  const markerIndex = styled.indexOf(marker)
  if (markerIndex < 0) return ""
  const prefix = styled.slice(0, markerIndex)
  return stripTrustedSgr(prefix) === "" ? prefix : ""
}

function foregroundAnsi(theme: Theme, color: ThemeColor): string {
  const ansiTheme = theme as ThemeWithAnsi
  if (typeof ansiTheme.getFgAnsi === "function") return ansiTheme.getFgAnsi(color)
  const marker = "diff-color-probe"
  return ansiPrefix(theme.fg(color, marker), marker)
}

function backgroundAnsi(theme: Theme, color: ThemeBackground): string {
  const ansiTheme = theme as ThemeWithAnsi
  if (typeof ansiTheme.getBgAnsi === "function") return ansiTheme.getBgAnsi(color)
  const marker = "diff-background-probe"
  return ansiPrefix(theme.bg(color, marker), marker)
}

function isNumberedRow(
  row: DiffDisplayRow,
): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
  return row.type === "context" || row.type === "addition" || row.type === "deletion"
}

function lineRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start}-${start + count - 1}`
}

function hunkRange(row: Extract<DiffDisplayRow, { type: "hunk" }>): string {
  return row.newCount > 0
    ? `lines ${lineRange(row.newStart, row.newCount)}`
    : `old lines ${lineRange(row.oldStart, row.oldCount)}`
}

function displayText(row: DiffDisplayRow, file: DiffFile): string {
  if (row.type === "hunk") {
    const section = row.sectionText ? ` ${row.sectionText}` : ""
    return `@@ ${file.path} · ${hunkRange(row)} @@${section}`
  }
  return row.text
}

function gutterDigits(rows: readonly DiffDisplayRow[]): number {
  return rows.reduce((width, row) => (isNumberedRow(row) ? Math.max(width, String(row.lineNumber).length) : width), 0)
}

function gutterText(row: DiffDisplayRow, digits: number, width: number): string {
  return isNumberedRow(row) ? `${row.marker}${String(row.lineNumber).padStart(digits)} │ ` : " ".repeat(width)
}

function rowForeground(row: DiffDisplayRow): ThemeColor {
  switch (row.type) {
    case "hunk":
      return "accent"
    case "summary":
    case "unknown":
      return "muted"
    case "context":
      return "toolDiffContext"
    default:
      return "text"
  }
}

function gutterForeground(row: DiffDisplayRow): ThemeColor {
  if (row.type === "addition") return "toolDiffAdded"
  if (row.type === "deletion") return "toolDiffRemoved"
  return row.type === "context" ? "toolDiffContext" : rowForeground(row)
}

function rowBackground(row: DiffDisplayRow): ThemeBackground | undefined {
  if (row.type === "addition") return "toolSuccessBg"
  return row.type === "deletion" ? "toolErrorBg" : undefined
}

function conflictStyle(row: DiffDisplayRow, text: string): { color: ThemeColor; bold: boolean } | undefined {
  if (!isNumberedRow(row)) return
  const rule = diffLineStyleForText(`${row.marker}${text}`)
  return rule?.bold ? { color: rule.color, bold: true } : undefined
}

function plainPresentationOnly(file: DiffFile, rows: readonly DiffDisplayRow[]): boolean {
  if (file.omission || file.status === "binary") return true
  if (rows.some((row) => row.type === "summary" && /^Binary(?: files| patch)/u.test(row.text))) return true
  return !rows.some(isNumberedRow) || !rows.some((row) => row.type === "hunk")
}

function preparedOrPlain(
  trustedText: string,
  plainText: string,
  options: Parameters<typeof prepareStyledColumns>[1],
): StyledColumns {
  const prepared = prepareStyledColumns(trustedText, { ...options, expectedPlainText: plainText })
  const fallback = prepared ?? prepareStyledColumns(plainText, { ...options, expectedPlainText: plainText })
  if (!fallback) throw new Error("normalized diff text could not be prepared")
  return fallback
}

function changedDecorations(
  row: DiffDisplayRow,
  spans: readonly { readonly start: number; readonly end: number }[] | undefined,
  backgroundAnsiCode: string,
): StyledSpanDecoration[] {
  if (!spans || (row.type !== "addition" && row.type !== "deletion")) return []
  return spans.map((span) => ({ ...span, backgroundAnsi: backgroundAnsiCode, bold: true }))
}

function rowDecorations(
  row: DiffDisplayRow,
  text: string,
  spans: readonly { readonly start: number; readonly end: number }[] | undefined,
  theme: Theme,
  changedBackgroundAnsi: string,
): StyledSpanDecoration[] {
  const conflict = conflictStyle(row, text)
  if (conflict && text.length > 0) {
    return [{ start: 0, end: text.length, foregroundAnsi: foregroundAnsi(theme, conflict.color), bold: true }]
  }
  return changedDecorations(row, spans, changedBackgroundAnsi)
}

function freezeSemanticRows(rows: DiffDisplayRow[]): readonly DiffDisplayRow[] {
  return Object.freeze(rows.map((row) => Object.freeze(row)))
}

interface RowPreparationContext {
  readonly theme: Theme
  readonly textByRow: readonly string[]
  readonly codeTextByRow: readonly string[]
  readonly highlightedByRow: readonly (string | undefined)[]
  readonly spansByRow?: readonly (readonly { readonly start: number; readonly end: number }[] | undefined)[]
  readonly richSyntax: boolean
  readonly additionBackgroundAnsi: string
  readonly deletionBackgroundAnsi: string
  readonly digits: number
  readonly gutterWidth: number
}

function highlightedText(
  context: RowPreparationContext,
  semantic: DiffDisplayRow,
  index: number,
  codeText: string,
): string | undefined {
  if (!context.richSyntax || conflictStyle(semantic, codeText)) return
  return context.highlightedByRow[index]
}

function preparePresentationRow(
  context: RowPreparationContext,
  semantic: DiffDisplayRow,
  index: number,
): PreparedDiffRow {
  const contentText = context.textByRow[index] ?? ""
  const codeText = context.codeTextByRow[index] ?? contentText
  const conflict = conflictStyle(semantic, codeText)
  const rowBackgroundCode = rowBackground(semantic)
  const backgroundCode = rowBackgroundCode && backgroundAnsi(context.theme, rowBackgroundCode)
  const contentForeground = foregroundAnsi(context.theme, conflict?.color ?? rowForeground(semantic))
  const changedBackgroundAnsi =
    semantic.type === "addition" ? context.additionBackgroundAnsi : context.deletionBackgroundAnsi
  const content = preparedOrPlain(highlightedText(context, semantic, index, codeText) ?? contentText, contentText, {
    baseForegroundAnsi: contentForeground,
    backgroundAnsi: backgroundCode,
    decorations: rowDecorations(semantic, codeText, context.spansByRow?.[index], context.theme, changedBackgroundAnsi),
    paddingForegroundAnsi: contentForeground,
    paddingBackgroundAnsi: backgroundCode,
  })
  const gutterForegroundCode = foregroundAnsi(context.theme, gutterForeground(semantic))
  const gutterPlainText = gutterText(semantic, context.digits, context.gutterWidth)
  const gutterBackgroundCode = rowBackgroundCode && backgroundAnsi(context.theme, rowBackgroundCode)
  const gutter = preparedOrPlain(gutterPlainText, gutterPlainText, {
    baseForegroundAnsi: gutterForegroundCode,
    backgroundAnsi: gutterBackgroundCode,
    paddingForegroundAnsi: gutterForegroundCode,
    paddingBackgroundAnsi: gutterBackgroundCode,
  })
  return Object.freeze({ semantic, gutter, content })
}

export function prepareDiffPresentation(
  file: DiffFile,
  theme: Theme,
  syntax: SyntaxHighlighting = piSyntaxHighlighting,
): PreparedDiffDisplay {
  const semanticRows = freezeSemanticRows(formatDiffDisplay(file))
  const textByRow = semanticRows.map((row) => normalizeDiffText(displayText(row, file)))
  const codeTextByRow = semanticRows.map((row, index) =>
    isNumberedRow(row) ? normalizeDiffText(row.text) : (textByRow[index] ?? ""),
  )
  const forcePlain = plainPresentationOnly(file, semanticRows)
  const syntaxPlan = forcePlain
    ? {
        highlightedByRow: Array<string | undefined>(semanticRows.length).fill(undefined),
        supported: false,
        fileLimitExceeded: false,
        highlighterCalls: 0,
      }
    : planDiffSyntax(file, semanticRows, codeTextByRow, syntax)
  const rich = !forcePlain && syntaxPlan.supported && !syntaxPlan.fileLimitExceeded
  const syntaxColorsEnabled = foregroundAnsi(theme, "text").length > 0
  const intraline = rich ? planIntralineChanges(semanticRows, codeTextByRow) : undefined
  const digits = gutterDigits(semanticRows)
  const gutterWidth = digits === 0 ? 0 : digits + 4

  const rowContext: RowPreparationContext = {
    theme,
    textByRow,
    codeTextByRow,
    highlightedByRow: syntaxPlan.highlightedByRow,
    spansByRow: intraline?.spansByRow,
    richSyntax: rich && syntaxColorsEnabled,
    additionBackgroundAnsi: blendedBackgroundAnsi(
      backgroundAnsi(theme, "toolSuccessBg"),
      foregroundAnsi(theme, "toolDiffAdded"),
    ),
    deletionBackgroundAnsi: blendedBackgroundAnsi(
      backgroundAnsi(theme, "toolErrorBg"),
      foregroundAnsi(theme, "toolDiffRemoved"),
    ),
    digits,
    gutterWidth,
  }
  const rows = semanticRows.map((semantic, index) => preparePresentationRow(rowContext, semantic, index))
  const maxContentWidth = rows.reduce((maximum, row) => Math.max(maximum, row.content.width), 0)
  const weightBytes = rows.reduce(
    (total, row) => total + 96 + row.gutter.weightBytes + row.content.weightBytes,
    semanticRows.reduce((total, row) => total + 128 + Buffer.byteLength(displayText(row, file), "utf8"), 128),
  )
  return Object.freeze({
    rows: Object.freeze(rows),
    gutterWidth,
    maxContentWidth,
    weightBytes,
    mode: rich ? "rich" : "plain",
    highlighterCalls: syntaxPlan.highlighterCalls,
  })
}
