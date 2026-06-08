import { visibleWidth } from "@earendil-works/pi-tui"

const ESCAPE = "\x1b"
const RESET = `${ESCAPE}[0m`
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

type StyledToken = { kind: "sgr"; code: string } | { kind: "text"; text: string; width: number }

function readSgrCode(line: string, index: number): { code: string; length: number } | undefined {
  if (line[index] !== ESCAPE || line[index + 1] !== "[") {
    return undefined
  }

  const end = line.indexOf("m", index + 2)
  return end === -1 ? undefined : { code: line.slice(index, end + 1), length: end + 1 - index }
}

function nextSgrStart(line: string, index: number): number {
  const start = line.indexOf(ESCAPE, index)
  return start === -1 ? line.length : start
}

function textTokens(text: string): StyledToken[] {
  return [...graphemeSegmenter.segment(text)].map(({ segment }) => ({
    kind: "text",
    text: segment,
    width: visibleWidth(segment),
  }))
}

function styledTokens(line: string): StyledToken[] {
  const tokens: StyledToken[] = []
  let index = 0

  while (index < line.length) {
    const sgr = readSgrCode(line, index)
    if (sgr) {
      tokens.push({ kind: "sgr", code: sgr.code })
      index += sgr.length
      continue
    }

    const textEnd = nextSgrStart(line, index + 1)
    tokens.push(...textTokens(line.slice(index, textEnd)))
    index = textEnd
  }

  return tokens
}

class SgrTracker {
  private activeCodes: string[] = []

  process(code: string): void {
    const params = code.slice(2, -1)
    this.activeCodes = params === "" || params === "0" ? [] : [...this.activeCodes, code]
  }

  activePrefix(): string {
    return this.activeCodes.join("")
  }
}

function appendTextInRange(
  result: string,
  token: Extract<StyledToken, { kind: "text" }>,
  currentColumn: number,
  range: { start: number; end: number },
  prefix: string,
): { result: string; started: boolean } {
  if (currentColumn < range.start || currentColumn >= range.end) {
    return { result, started: false }
  }

  const started = result.length > 0
  return { result: `${result}${started ? "" : prefix}${token.text}`, started: true }
}

function closeSgrSegment(segment: string): string {
  if (!segment.includes(ESCAPE) || segment.endsWith(RESET)) {
    return segment
  }
  return `${segment}${RESET}`
}

function blankStyledSegment(segment: string): string {
  return styledTokens(segment)
    .map((token) => (token.kind === "sgr" ? token.code : " ".repeat(token.width)))
    .join("")
}

export function sliceStyledColumns(line: string, startColumn: number, length: number): string {
  const range = { start: startColumn, end: startColumn + length }
  const tracker = new SgrTracker()
  let result = ""
  let currentColumn = 0

  for (const token of styledTokens(line)) {
    if (token.kind === "sgr") {
      tracker.process(token.code)
      continue
    }

    const appended = appendTextInRange(result, token, currentColumn, range, tracker.activePrefix())
    result = appended.result
    currentColumn += token.width
    if (currentColumn >= range.end) {
      break
    }
  }

  return result
}

export function copyStyledColumns(line: string, startColumn: number, length: number): string {
  if (length <= 0) {
    return ""
  }

  return closeSgrSegment(sliceStyledColumns(line, startColumn, length))
}

export function blankStyledColumns(line: string, startColumn: number, length: number): string {
  if (length <= 0) {
    return ""
  }

  const blankSegment = blankStyledSegment(sliceStyledColumns(line, startColumn, length))
  const padding = " ".repeat(Math.max(0, length - visibleWidth(blankSegment)))
  return closeSgrSegment(`${blankSegment}${padding}`)
}
