import { fit } from "./render-text.js"

export interface ScrollbarOptions {
  width: number
  viewportHeight: number
  contentHeight: number
  scrollOffset: number
  theme: { fg(color: string, text: string): string }
  minWidth?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function withBlankEdge(lines: string[], width: number): string[] {
  if (width <= 0) {
    return lines.map((line) => fit(line, width))
  }

  const bodyWidth = width - 1
  return lines.map((line) => `${fit(line, bodyWidth)} `)
}

export function renderScrollbar(lines: string[], options: ScrollbarOptions): string[] {
  const { width, viewportHeight, contentHeight, scrollOffset, theme, minWidth } = options
  const belowMinWidth = minWidth !== undefined && width < minWidth
  const scrollable = contentHeight > viewportHeight && viewportHeight > 0

  if (belowMinWidth || !scrollable) {
    return withBlankEdge(lines, width)
  }

  if (width <= 0) {
    return lines.map((line) => fit(line, width))
  }

  const bodyWidth = width - 1
  const thumbHeight = Math.min(
    viewportHeight,
    Math.max(1, Math.round((viewportHeight / contentHeight) * viewportHeight)),
  )
  const remainingTrack = Math.max(0, viewportHeight - thumbHeight)
  const maxScrollOffset = Math.max(1, contentHeight - viewportHeight)
  const clampedScrollOffset = clamp(scrollOffset, 0, maxScrollOffset)
  const thumbTop = Math.round((clampedScrollOffset / maxScrollOffset) * remainingTrack)

  return lines.map((line, index) => {
    const inThumb = index >= thumbTop && index < thumbTop + thumbHeight
    const marker = theme.fg("dim", inThumb ? "┃" : "│")
    return `${fit(line, bodyWidth)}${marker}`
  })
}
