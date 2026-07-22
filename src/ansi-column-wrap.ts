import { visibleWidth } from "@earendil-works/pi-tui"
import type { StyledColumns } from "./ansi-segments.js"

const CHECKPOINT_INTERVAL = 256
const asciiPattern = /^[\x20-\x7e]*$/u
const whitespaceOnlyPattern = /^ *$/u
const whitespacePattern = /^\s+$/u
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export interface StyledColumnSlice {
  readonly start: number
  readonly length: number
}

export interface PreparedColumnWrap {
  readonly segmentCount: number
  segments(startSegment: number, count: number): readonly StyledColumnSlice[]
}

export interface WrappedColumnMeasure {
  readonly segmentCount: number
  readonly truncated: boolean
}

interface ColumnMap {
  readonly ascii: boolean
  readonly count: number
  readonly columns?: Int32Array
  readonly offsets?: Int32Array
}

interface WrapCheckpoint {
  readonly segment: number
  readonly column: number
  readonly graphemeIndex: number
}

interface WrapState {
  column: number
  graphemeIndex: number
  segmentStart: number
  segmentLength: number
}

const columnMaps = new WeakMap<StyledColumns, ColumnMap>()

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function columnMap(line: StyledColumns): ColumnMap {
  const cached = columnMaps.get(line)
  if (cached) return cached
  if (asciiPattern.test(line.plainText)) {
    const ascii = Object.freeze({ ascii: true, count: line.plainText.length })
    columnMaps.set(line, ascii)
    return ascii
  }
  const offsets: number[] = []
  const columns: number[] = []
  let column = 0
  for (const { index, segment } of graphemeSegmenter.segment(line.plainText)) {
    offsets.push(index)
    columns.push(column)
    column += visibleWidth(segment)
  }
  offsets.push(line.plainText.length)
  columns.push(column)
  const mapped = Object.freeze({
    ascii: false,
    count: Math.max(0, offsets.length - 1),
    columns: Int32Array.from(columns),
    offsets: Int32Array.from(offsets),
  })
  columnMaps.set(line, mapped)
  return mapped
}

function graphemeColumn(map: ColumnMap, index: number): number {
  return map.ascii ? index : (map.columns?.[index] ?? 0)
}

function isWhitespace(line: StyledColumns, map: ColumnMap, index: number): boolean {
  if (map.ascii) return line.plainText.charCodeAt(index) === 0x20
  const start = map.offsets?.[index] ?? 0
  const end = map.offsets?.[index + 1] ?? start
  return whitespacePattern.test(line.plainText.slice(start, end))
}

function advanceWrappedSegment(line: StyledColumns, map: ColumnMap, width: number, state: WrapState): boolean {
  if (state.column >= line.width) return false
  const start = state.column
  const limit = start + width
  let fittedEnd = start
  let fittedIndex = state.graphemeIndex
  let breakEnd = start
  let breakIndex = state.graphemeIndex
  while (fittedIndex < map.count) {
    const graphemeEnd = graphemeColumn(map, fittedIndex + 1)
    if (graphemeEnd > limit) break
    fittedEnd = graphemeEnd
    fittedIndex++
    if (isWhitespace(line, map, fittedIndex - 1)) {
      breakEnd = fittedEnd
      breakIndex = fittedIndex
    }
  }

  let end = fittedIndex === map.count ? line.width : breakEnd
  let nextIndex = fittedIndex === map.count ? map.count : breakIndex
  if (end <= start) {
    end = fittedEnd
    nextIndex = fittedIndex
  }
  if (end <= start) {
    end = Math.min(line.width, start + width)
    if (end >= graphemeColumn(map, state.graphemeIndex + 1)) nextIndex = state.graphemeIndex + 1
  }
  state.column = end
  state.graphemeIndex = nextIndex
  state.segmentStart = start
  state.segmentLength = end - start
  return true
}

function slicesFromFixedWidth(
  lineWidth: number,
  width: number,
  startSegment: number,
  count: number,
): StyledColumnSlice[] {
  const first = whole(startSegment)
  const available = Math.max(0, Math.ceil(lineWidth / width) - first)
  return Array.from({ length: Math.min(whole(count), available) }, (_value, index) => {
    const start = (first + index) * width
    return Object.freeze({ start, length: Math.min(width, lineWidth - start) })
  })
}

function fixedWidthPlan(lineWidth: number, width: number): PreparedColumnWrap {
  const segmentCount = Math.max(1, Math.ceil(lineWidth / width))
  return Object.freeze({
    segmentCount,
    segments: (startSegment: number, count: number) =>
      Object.freeze(slicesFromFixedWidth(lineWidth, width, startSegment, count)),
  })
}

function singleSegmentPlan(lineWidth: number): PreparedColumnWrap {
  return Object.freeze({
    segmentCount: 1,
    segments: (startSegment: number, count: number) =>
      whole(startSegment) === 0 && whole(count) > 0
        ? Object.freeze([{ start: 0, length: lineWidth }])
        : Object.freeze([]),
  })
}

function usesFixedWidthWrapping(line: StyledColumns, width: number): boolean {
  return (
    asciiPattern.test(line.plainText) &&
    (width === 1 || !line.plainText.includes(" ") || whitespaceOnlyPattern.test(line.plainText))
  )
}

export function measureWrappedColumns(
  line: StyledColumns,
  maxWidth: number,
  maximumSegments: number,
): WrappedColumnMeasure {
  const width = whole(maxWidth)
  const limit = whole(maximumSegments)
  if (width === 0 || line.width === 0 || line.width <= width) {
    return Object.freeze({ segmentCount: Math.min(1, limit), truncated: limit === 0 })
  }
  if (usesFixedWidthWrapping(line, width)) {
    const segmentCount = Math.ceil(line.width / width)
    return Object.freeze({ segmentCount: Math.min(segmentCount, limit), truncated: segmentCount > limit })
  }
  const map = columnMap(line)
  const state: WrapState = { column: 0, graphemeIndex: 0, segmentStart: 0, segmentLength: 0 }
  let segmentCount = 0
  while (segmentCount < limit) {
    if (!advanceWrappedSegment(line, map, width, state)) {
      return Object.freeze({ segmentCount, truncated: false })
    }
    segmentCount++
  }
  return Object.freeze({ segmentCount, truncated: advanceWrappedSegment(line, map, width, state) })
}

export function prepareColumnWrap(line: StyledColumns, maxWidth: number): PreparedColumnWrap {
  const width = whole(maxWidth)
  if (width === 0 || line.width === 0 || line.width <= width) return singleSegmentPlan(line.width)
  if (usesFixedWidthWrapping(line, width)) return fixedWidthPlan(line.width, width)

  const map = columnMap(line)
  const checkpoints: WrapCheckpoint[] = []
  const state: WrapState = { column: 0, graphemeIndex: 0, segmentStart: 0, segmentLength: 0 }
  let segmentCount = 0
  while (state.column < line.width) {
    if (segmentCount % CHECKPOINT_INTERVAL === 0) {
      checkpoints.push(
        Object.freeze({ segment: segmentCount, column: state.column, graphemeIndex: state.graphemeIndex }),
      )
    }
    if (!advanceWrappedSegment(line, map, width, state)) break
    segmentCount++
  }

  return Object.freeze({
    segmentCount: Math.max(1, segmentCount),
    segments(startSegment: number, count: number) {
      const first = Math.min(whole(startSegment), segmentCount)
      const requested = Math.min(whole(count), segmentCount - first)
      if (requested === 0) return Object.freeze([])
      const checkpoint = checkpoints[Math.floor(first / CHECKPOINT_INTERVAL)] ?? checkpoints[0]
      if (!checkpoint) return Object.freeze([])
      const cursor: WrapState = {
        column: checkpoint.column,
        graphemeIndex: checkpoint.graphemeIndex,
        segmentStart: checkpoint.column,
        segmentLength: 0,
      }
      for (let index = checkpoint.segment; index < first; index++) advanceWrappedSegment(line, map, width, cursor)
      const slices: StyledColumnSlice[] = []
      for (let index = 0; index < requested; index++) {
        if (!advanceWrappedSegment(line, map, width, cursor)) break
        slices.push(Object.freeze({ start: cursor.segmentStart, length: cursor.segmentLength }))
      }
      return Object.freeze(slices)
    },
  })
}
