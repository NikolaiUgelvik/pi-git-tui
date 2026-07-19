const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export interface IntralineRange {
  readonly start: number
  readonly end: number
}

export interface RelativeIntralineChanges {
  readonly oldRange?: IntralineRange
  readonly newRange?: IntralineRange
  readonly graphemeCount: number
}

interface Grapheme {
  readonly text: string
  readonly start: number
  readonly end: number
}

function graphemes(text: string, maximum: number): Grapheme[] | undefined {
  const result: Grapheme[] = []
  for (const { index, segment } of graphemeSegmenter.segment(text)) {
    if (result.length >= maximum) return
    result.push({ text: segment, start: index, end: index + segment.length })
  }
  return result
}

function changedRange(
  parts: readonly Grapheme[],
  prefix: number,
  suffix: number,
  textLength: number,
): IntralineRange | undefined {
  const first = parts[prefix]
  const last = parts[parts.length - suffix - 1]
  const start = first?.start ?? textLength
  const end = last?.end ?? start
  return end > start ? { start, end } : undefined
}

export function relativeIntralineChanges(
  oldText: string,
  newText: string,
  maximumGraphemes: number,
): RelativeIntralineChanges | undefined {
  const oldParts = graphemes(oldText, maximumGraphemes)
  const newParts = graphemes(newText, maximumGraphemes)
  if (!oldParts || !newParts) return

  const sharedLength = Math.min(oldParts.length, newParts.length)
  let prefix = 0
  while (prefix < sharedLength && oldParts[prefix]?.text === newParts[prefix]?.text) prefix++

  let suffix = 0
  while (
    suffix < sharedLength - prefix &&
    oldParts[oldParts.length - suffix - 1]?.text === newParts[newParts.length - suffix - 1]?.text
  ) {
    suffix++
  }

  return {
    oldRange: changedRange(oldParts, prefix, suffix, oldText.length),
    newRange: changedRange(newParts, prefix, suffix, newText.length),
    graphemeCount: oldParts.length + newParts.length,
  }
}
