import type { Theme } from "@earendil-works/pi-coding-agent"
import { fit } from "./render-text.js"
import { measureOverlayGeometry, type OverlayGeometry } from "./responsive-geometry.js"

export interface OverlayFrame {
  geometry: OverlayGeometry
  innerWidth: number
  bodyRows: number
  maxItems: number
  compact: boolean
  row: (content: string) => string
  border: (edge: "top" | "bottom") => string
}

function overlayRow(content: string, width: number, theme: Theme): string {
  if (width <= 0) {
    return ""
  }
  if (width === 1) {
    return theme.fg("border", "│")
  }
  const inner = fit(content, width - 2)
  return `${theme.fg("border", "│")}${inner}${theme.fg("border", "│")}`
}

function overlayBorder(edge: "top" | "bottom", width: number, theme: Theme): string {
  if (width <= 0) {
    return ""
  }
  const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"]
  if (width === 1) {
    return theme.fg("border", left)
  }
  return theme.fg("border", `${left}${"─".repeat(Math.max(0, width - 2))}${right}`)
}

export function createOverlayFrame(baseLineCount: number, width: number, theme: Theme): OverlayFrame {
  const geometry = measureOverlayGeometry({ width, height: baseLineCount })
  const compact = geometry.density === "compact"
  const searchChromeRows = compact ? 1 : 3
  const maxItems = Math.max(0, Math.min(13, geometry.bodyRows - searchChromeRows))

  return {
    geometry,
    innerWidth: geometry.innerWidth,
    bodyRows: geometry.bodyRows,
    maxItems,
    compact,
    row: (content: string): string => overlayRow(content, geometry.width, theme),
    border: (edge: "top" | "bottom"): string => overlayBorder(edge, geometry.width, theme),
  }
}

function fittedBody(frame: OverlayFrame, body: string[]): string[] {
  const visible = body.slice(0, frame.bodyRows)
  while (visible.length < frame.bodyRows) {
    visible.push("")
  }
  return visible.map(frame.row)
}

export function renderOverlayFrame(frame: OverlayFrame, title: string, hint: string, body: string[]): string[] {
  const { height } = frame.geometry
  if (height <= 0) {
    return []
  }
  if (height === 1) {
    return [frame.border("top")]
  }
  if (height === 2) {
    return [frame.border("top"), frame.border("bottom")]
  }
  if (height === 3) {
    return [frame.border("top"), frame.row(title), frame.border("bottom")]
  }
  return [frame.border("top"), frame.row(title), frame.row(hint), ...fittedBody(frame, body), frame.border("bottom")]
}

export function renderSearchOverlayFrame(
  frame: OverlayFrame,
  theme: Theme,
  title: string,
  hint: string,
  searchLine: string,
  bodyRows: string[],
): string[] {
  const body = frame.compact ? [searchLine, ...bodyRows] : [searchLine, "", ...bodyRows, ""]
  return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold(title))}`, ` ${theme.fg("dim", hint)}`, body)
}
