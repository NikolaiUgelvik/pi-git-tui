import { sliceStyledColumns } from "./ansi-segments.js"
import { fit } from "./render-text.js"
import { measureOverlayGeometry, type OverlayDensity } from "./responsive-geometry.js"
import { DiffViewerFrame } from "./viewer-frame.js"

export interface ViewerOverlayLayout {
  overlayWidth: number
  leftPad: number
  startLine: number
  height: number
  maxItems: number
  density: OverlayDensity
}

export class DiffViewerOverlayBase extends DiffViewerFrame {
  protected commitPickerOverlayLayout(baseLineCount: number, width: number): ViewerOverlayLayout {
    const geometry = measureOverlayGeometry({ width, height: baseLineCount })
    const searchChromeRows = geometry.density === "compact" ? 1 : 3
    return {
      overlayWidth: geometry.width,
      leftPad: geometry.left,
      startLine: geometry.top,
      height: geometry.height,
      maxItems: Math.max(0, Math.min(13, geometry.bodyRows - searchChromeRows)),
      density: geometry.density,
    }
  }

  protected renderPickerOverlay(
    baseLines: string[],
    width: number,
    renderOverlay: (baseLineCount: number, width: number) => string[],
  ): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = renderOverlay(baseLines.length, width)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected commitPickerOverlayRow(content: string, overlayWidth: number): string {
    if (overlayWidth <= 0) {
      return ""
    }
    if (overlayWidth === 1) {
      return this.theme.fg("border", "│")
    }
    const inner = fit(content, overlayWidth - 2)
    return `${this.theme.fg("border", "│")}${inner}${this.theme.fg("border", "│")}`
  }

  protected commitPickerBorder(edge: "top" | "bottom", overlayWidth: number): string {
    if (overlayWidth <= 0) {
      return ""
    }
    const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"]
    if (overlayWidth === 1) {
      return this.theme.fg("border", left)
    }
    return this.theme.fg("border", `${left}${"─".repeat(Math.max(0, overlayWidth - 2))}${right}`)
  }

  protected applyCommitPickerOverlay(
    baseLines: string[],
    overlay: string[],
    layout: ViewerOverlayLayout,
    width: number,
  ): string[] {
    const result = [...baseLines]
    const overlayRows = Math.min(overlay.length, layout.height, Math.max(0, result.length - layout.startLine))
    for (let index = 0; index < overlayRows; index++) {
      const lineIndex = layout.startLine + index
      result[lineIndex] = this.mergeOverlayLine(result[lineIndex], overlay[index] ?? "", layout, width)
    }
    return result.slice(0, baseLines.length).map((line) => fit(line, width))
  }

  protected mergeOverlayLine(
    baseLine: string | undefined,
    overlayLine: string,
    layout: { overlayWidth: number; leftPad: number },
    width: number,
  ): string {
    const base = baseLine ?? ""
    const prefix = fit(sliceStyledColumns(base, 0, layout.leftPad), layout.leftPad)
    const suffixStart = layout.leftPad + layout.overlayWidth
    const suffixLength = Math.max(0, width - suffixStart)
    const suffix = sliceStyledColumns(base, suffixStart, suffixLength)
    return fit(prefix + fit(overlayLine, layout.overlayWidth) + this.closeAnsiSegment(suffix), width)
  }

  private closeAnsiSegment(segment: string): string {
    if (!segment.includes("\x1b") || segment.endsWith("\x1b[0m")) {
      return segment
    }
    return `${segment}\x1b[0m`
  }
}
