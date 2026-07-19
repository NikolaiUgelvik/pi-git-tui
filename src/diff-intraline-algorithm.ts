const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const WORD_GRAPHEME = /^[\p{L}\p{M}\p{N}_]+$/u
const WHITESPACE_GRAPHEME = /^\s+$/u
const LINE_GAP_SCORE = -350

export interface IntralineToken {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly whitespace: boolean
}

export interface TokenizedIntralineLine {
  readonly text: string
  readonly tokens: readonly IntralineToken[]
  readonly graphemeCount: number
}

export interface LineAlignmentEntry {
  readonly oldIndex?: number
  readonly newIndex?: number
}

function tokenKind(grapheme: string): "word" | "whitespace" | "symbol" {
  if (WHITESPACE_GRAPHEME.test(grapheme)) return "whitespace"
  return WORD_GRAPHEME.test(grapheme) ? "word" : "symbol"
}

export function tokenizeIntralineLine(
  text: string,
  maximumGraphemes: number,
  maximumTokens: number,
): TokenizedIntralineLine | undefined {
  const tokens: IntralineToken[] = []
  let graphemeCount = 0
  let activeKind: "word" | "whitespace" | "symbol" | undefined
  for (const { index, segment } of graphemeSegmenter.segment(text)) {
    graphemeCount++
    if (graphemeCount > maximumGraphemes) return
    const kind = tokenKind(segment)
    const previous = tokens.at(-1)
    if (kind !== "symbol" && kind === activeKind && previous) {
      tokens[tokens.length - 1] = { ...previous, text: previous.text + segment, end: index + segment.length }
      continue
    }
    tokens.push({ text: segment, start: index, end: index + segment.length, whitespace: kind === "whitespace" })
    if (tokens.length > maximumTokens) return
    activeKind = kind
  }
  return { text, tokens, graphemeCount }
}

function tokenIntersection(left: readonly IntralineToken[], right: readonly IntralineToken[]): number {
  const counts = new Map<string, number>()
  for (const token of left) counts.set(token.text, (counts.get(token.text) ?? 0) + 1)
  let intersection = 0
  for (const token of right) {
    const count = counts.get(token.text) ?? 0
    if (count === 0) continue
    intersection++
    counts.set(token.text, count - 1)
  }
  return intersection
}

function diceSimilarity(left: TokenizedIntralineLine, right: TokenizedIntralineLine): number {
  const denominator = left.tokens.length + right.tokens.length
  if (denominator === 0) return 1_000
  return Math.floor((2_000 * tokenIntersection(left.tokens, right.tokens)) / denominator)
}

function linePairScore(left: TokenizedIntralineLine, right: TokenizedIntralineLine): number {
  return 2 * diceSimilarity(left, right) - 1_000
}

export function alignIntralineLines(
  oldLines: readonly TokenizedIntralineLine[],
  newLines: readonly TokenizedIntralineLine[],
): readonly LineAlignmentEntry[] {
  const columns = newLines.length + 1
  const cells = (oldLines.length + 1) * columns
  const scores = new Int32Array(cells)
  const trace = new Uint8Array(cells)
  for (let oldIndex = 1; oldIndex <= oldLines.length; oldIndex++) {
    scores[oldIndex * columns] = oldIndex * LINE_GAP_SCORE
    trace[oldIndex * columns] = 1
  }
  for (let newIndex = 1; newIndex <= newLines.length; newIndex++) {
    scores[newIndex] = newIndex * LINE_GAP_SCORE
    trace[newIndex] = 2
  }

  for (let oldIndex = 1; oldIndex <= oldLines.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= newLines.length; newIndex++) {
      const cell = oldIndex * columns + newIndex
      let best =
        scores[(oldIndex - 1) * columns + newIndex - 1] +
        linePairScore(
          oldLines[oldIndex - 1] as TokenizedIntralineLine,
          newLines[newIndex - 1] as TokenizedIntralineLine,
        )
      let direction = 0
      const oldGap = scores[(oldIndex - 1) * columns + newIndex] + LINE_GAP_SCORE
      if (oldGap > best) {
        best = oldGap
        direction = 1
      }
      const newGap = scores[oldIndex * columns + newIndex - 1] + LINE_GAP_SCORE
      if (newGap > best) {
        best = newGap
        direction = 2
      }
      scores[cell] = best
      trace[cell] = direction
    }
  }

  const result: LineAlignmentEntry[] = []
  let oldIndex = oldLines.length
  let newIndex = newLines.length
  while (oldIndex > 0 || newIndex > 0) {
    const direction = trace[oldIndex * columns + newIndex]
    if (oldIndex > 0 && newIndex > 0 && direction === 0) {
      result.push({ oldIndex: --oldIndex, newIndex: --newIndex })
    } else if (oldIndex > 0 && (newIndex === 0 || direction === 1)) {
      result.push({ oldIndex: --oldIndex })
    } else {
      result.push({ newIndex: --newIndex })
    }
  }
  return result.reverse()
}

export interface TokenChanges {
  readonly oldChanged: readonly number[]
  readonly newChanged: readonly number[]
}

export function changedTokenIndices(
  oldTokens: readonly IntralineToken[],
  newTokens: readonly IntralineToken[],
): TokenChanges {
  const columns = newTokens.length + 1
  const lengths = new Uint16Array((oldTokens.length + 1) * columns)
  for (let oldIndex = 1; oldIndex <= oldTokens.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= newTokens.length; newIndex++) {
      const cell = oldIndex * columns + newIndex
      lengths[cell] =
        oldTokens[oldIndex - 1]?.text === newTokens[newIndex - 1]?.text
          ? (lengths[(oldIndex - 1) * columns + newIndex - 1] ?? 0) + 1
          : Math.max(lengths[(oldIndex - 1) * columns + newIndex] ?? 0, lengths[oldIndex * columns + newIndex - 1] ?? 0)
    }
  }

  const matchedOld = new Uint8Array(oldTokens.length)
  const matchedNew = new Uint8Array(newTokens.length)
  let oldIndex = oldTokens.length
  let newIndex = newTokens.length
  while (oldIndex > 0 && newIndex > 0) {
    if (oldTokens[oldIndex - 1]?.text === newTokens[newIndex - 1]?.text) {
      matchedOld[--oldIndex] = 1
      matchedNew[--newIndex] = 1
    } else if (
      (lengths[(oldIndex - 1) * columns + newIndex] ?? 0) >= (lengths[oldIndex * columns + newIndex - 1] ?? 0)
    ) {
      oldIndex--
    } else {
      newIndex--
    }
  }
  return {
    oldChanged: oldTokens.flatMap((_token, index) => (matchedOld[index] === 0 ? [index] : [])),
    newChanged: newTokens.flatMap((_token, index) => (matchedNew[index] === 0 ? [index] : [])),
  }
}
