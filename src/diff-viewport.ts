import type { Theme } from "@earendil-works/pi-coding-agent"
import { slicePreparedColumns } from "./ansi-segments.js"
import type { PreparedDiffDisplay } from "./diff-presentation.js"

export interface DiffViewportInput {
  readonly display: PreparedDiffDisplay
  readonly width: number
  readonly height: number
  readonly verticalOffset: number
  readonly horizontalOffset: number
  readonly theme: Theme
}

export interface DiffViewportResult {
  readonly lines: string[]
  readonly verticalOffset: number
  readonly horizontalOffset: number
  readonly maxVerticalOffset: number
  readonly maxHorizontalOffset: number
  readonly horizontallyScrollable: boolean
  readonly gutterWidth: number
  readonly contentWidth: number
}

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, whole(value)))
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
  const maxVerticalOffset = Math.max(0, input.display.rows.length - height)
  const verticalOffset = clamp(input.verticalOffset, maxVerticalOffset)
  const verticallyScrollable = width > 0 && height > 0 && input.display.rows.length > height
  const bodyWidth = Math.max(0, width - (verticallyScrollable ? 1 : 0))
  const visibleGutterWidth = Math.min(bodyWidth, input.display.gutterWidth)
  const contentWidth = Math.max(0, bodyWidth - visibleGutterWidth)
  const maxHorizontalOffset = Math.max(0, input.display.maxContentWidth - contentWidth)
  const horizontalOffset = clamp(input.horizontalOffset, maxHorizontalOffset)
  const visibleRows = input.display.rows.slice(verticalOffset, verticalOffset + height)
  const lines = visibleRows.map((row, index) => {
    const gutter = slicePreparedColumns(row.gutter, 0, visibleGutterWidth, { pad: true })
    const content = slicePreparedColumns(row.content, horizontalOffset, contentWidth, { pad: true })
    const scrollbar = verticallyScrollable
      ? scrollbarMarker(index, height, input.display.rows.length, verticalOffset, input.theme)
      : ""
    return `${gutter}${content}${scrollbar}`
  })
  while (lines.length < height) lines.push(" ".repeat(width))

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
