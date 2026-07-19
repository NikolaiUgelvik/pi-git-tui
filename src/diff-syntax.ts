import { posix } from "node:path"
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent"
import { stripTrustedSgr } from "./ansi-segments.js"
import type { DiffDisplayRow } from "./diff-display.js"
import type { DiffFile } from "./types.js"

export interface SyntaxHighlighting {
  languageFromPath(path: string): string | undefined
  highlight(code: string, language: string): readonly string[]
}

export const piSyntaxHighlighting: SyntaxHighlighting = {
  languageFromPath: getLanguageFromPath,
  highlight: highlightCode,
}

export interface DiffSyntaxPlan {
  /** Trusted generated ANSI, indexed like display rows. */
  readonly highlightedByRow: readonly (string | undefined)[]
  readonly supported: boolean
  readonly fileLimitExceeded: boolean
  readonly highlighterCalls: number
}

export interface DiffSyntaxLimits {
  readonly richCodeRowsPerFile: number
  readonly normalizedCodeBytesPerFile: number
  readonly hunksPerFile: number
  readonly linesPerSideSegment: number
  readonly bytesPerSideSegment: number
  readonly retainedGeneratedAnsiPerFile: number
}

export const DIFF_SYNTAX_LIMITS: Readonly<DiffSyntaxLimits> = Object.freeze({
  richCodeRowsPerFile: 10_000,
  normalizedCodeBytesPerFile: 512 * 1024,
  hunksPerFile: 256,
  linesPerSideSegment: 4_096,
  bytesPerSideSegment: 256 * 1024,
  retainedGeneratedAnsiPerFile: 2 * 1024 * 1024,
})

interface HunkSegment {
  readonly rowIndices: readonly number[]
}

interface Languages {
  readonly oldLanguage?: string
  readonly newLanguage?: string
}

function isCodeRow(row: DiffDisplayRow): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
  return row.type === "context" || row.type === "addition" || row.type === "deletion"
}

function isConflictMarker(text: string): boolean {
  return ["<<<<<<<", "|||||||", "=======", ">>>>>>>"].some((marker) => text.startsWith(marker))
}

function diffSyntaxFileWithinLimits(rows: readonly DiffDisplayRow[], normalizedTextByRow: readonly string[]): boolean {
  let codeRows = 0
  let codeBytes = 0
  let hunks = 0
  for (const [index, row] of rows.entries()) {
    if (row.type === "hunk") hunks++
    if (!isCodeRow(row)) continue
    if (codeRows > 0) codeBytes++
    codeRows++
    codeBytes += Buffer.byteLength(normalizedTextByRow[index] ?? "", "utf8")
  }
  return (
    codeRows <= DIFF_SYNTAX_LIMITS.richCodeRowsPerFile &&
    codeBytes <= DIFF_SYNTAX_LIMITS.normalizedCodeBytesPerFile &&
    hunks <= DIFF_SYNTAX_LIMITS.hunksPerFile
  )
}

function languageForCandidates(
  syntax: SyntaxHighlighting,
  candidates: readonly (string | undefined)[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate || candidate === "/dev/null") continue
    for (const path of new Set([candidate, posix.basename(candidate)])) {
      try {
        const language = syntax.languageFromPath(path)
        if (language) return language
      } catch {
        // Language detection is best-effort.
      }
    }
  }
}

function languagesForFile(file: DiffFile, syntax: SyntaxHighlighting): Languages {
  return {
    oldLanguage: languageForCandidates(syntax, [file.oldPath, file.path]),
    newLanguage: languageForCandidates(syntax, [file.newPath, file.path]),
  }
}

function hunkSegments(rows: readonly DiffDisplayRow[], textByRow: readonly string[]): HunkSegment[] {
  const segments: HunkSegment[] = []
  let current: number[] = []
  let inHunk = false
  const flush = (): void => {
    if (current.length > 0) segments.push({ rowIndices: current })
    current = []
  }
  for (const [index, row] of rows.entries()) {
    if (row.type === "hunk") {
      flush()
      inHunk = true
      continue
    }
    if (!inHunk || !isCodeRow(row) || isConflictMarker(textByRow[index] ?? "")) {
      flush()
      continue
    }
    current.push(index)
  }
  flush()
  return segments
}

function sideRows(segment: HunkSegment, rows: readonly DiffDisplayRow[], side: "old" | "new"): number[] {
  return segment.rowIndices.filter((index) => {
    const type = rows[index]?.type
    return side === "old" ? type === "context" || type === "deletion" : type === "context" || type === "addition"
  })
}

function validHighlightedLines(output: unknown, inputLines: readonly string[]): output is readonly string[] {
  return (
    Array.isArray(output) &&
    output.length === inputLines.length &&
    output.every((line, index) => typeof line === "string" && stripTrustedSgr(line) === inputLines[index])
  )
}

function highlightSide(
  rowIndices: readonly number[],
  textByRow: readonly string[],
  language: string | undefined,
  syntax: SyntaxHighlighting,
): { lines?: readonly string[]; calls: number; ansiBytes: number } {
  if (!language || rowIndices.length === 0 || rowIndices.length > DIFF_SYNTAX_LIMITS.linesPerSideSegment) {
    return { calls: 0, ansiBytes: 0 }
  }
  const inputLines = rowIndices.map((index) => textByRow[index] ?? "")
  const code = inputLines.join("\n")
  if (Buffer.byteLength(code, "utf8") > DIFF_SYNTAX_LIMITS.bytesPerSideSegment) {
    return { calls: 0, ansiBytes: 0 }
  }
  try {
    const output: unknown = syntax.highlight(code, language)
    if (!validHighlightedLines(output, inputLines)) return { calls: 1, ansiBytes: 0 }
    return {
      lines: output,
      calls: 1,
      ansiBytes: output.reduce((total, line) => total + Buffer.byteLength(line, "utf8"), 0),
    }
  } catch {
    return { calls: 1, ansiBytes: 0 }
  }
}

export function planDiffSyntax(
  file: DiffFile,
  rows: readonly DiffDisplayRow[],
  normalizedTextByRow: readonly string[],
  syntax: SyntaxHighlighting,
): DiffSyntaxPlan {
  const empty = (): DiffSyntaxPlan => ({
    highlightedByRow: Object.freeze(Array<string | undefined>(rows.length).fill(undefined)),
    supported: false,
    fileLimitExceeded: true,
    highlighterCalls: 0,
  })
  if (rows.length !== normalizedTextByRow.length || !diffSyntaxFileWithinLimits(rows, normalizedTextByRow))
    return empty()

  const languages = languagesForFile(file, syntax)
  const supported = languages.oldLanguage !== undefined || languages.newLanguage !== undefined
  const oldByRow: (string | undefined)[] = Array(rows.length).fill(undefined)
  const newByRow: (string | undefined)[] = Array(rows.length).fill(undefined)
  let highlighterCalls = 0
  let retainedAnsi = 0
  for (const segment of hunkSegments(rows, normalizedTextByRow)) {
    for (const side of ["old", "new"] as const) {
      const indices = sideRows(segment, rows, side)
      const result = highlightSide(
        indices,
        normalizedTextByRow,
        side === "old" ? languages.oldLanguage : languages.newLanguage,
        syntax,
      )
      highlighterCalls += result.calls
      retainedAnsi += result.ansiBytes
      if (retainedAnsi > DIFF_SYNTAX_LIMITS.retainedGeneratedAnsiPerFile) {
        return {
          highlightedByRow: Object.freeze(Array<string | undefined>(rows.length).fill(undefined)),
          supported,
          fileLimitExceeded: true,
          highlighterCalls,
        }
      }
      if (!result.lines) continue
      const target = side === "old" ? oldByRow : newByRow
      for (const [outputIndex, rowIndex] of indices.entries()) target[rowIndex] = result.lines[outputIndex]
    }
  }

  const highlightedByRow = rows.map((row, index) => {
    if (row.type === "deletion") return oldByRow[index]
    if (row.type === "addition") return newByRow[index]
    return row.type === "context" ? (newByRow[index] ?? oldByRow[index]) : undefined
  })
  return { highlightedByRow: Object.freeze(highlightedByRow), supported, fileLimitExceeded: false, highlighterCalls }
}
