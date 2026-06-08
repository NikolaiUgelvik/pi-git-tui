import { blankStyledColumns } from "./ansi-segments.js"
import { fit } from "./render-text.js"
import { DiffViewerFrame } from "./viewer-frame.js"

export class DiffViewerOverlayBase extends DiffViewerFrame {
  protected commitPickerOverlayLayout(baseLineCount: number, width: number) {
    const overlayWidth = Math.max(50, Math.min(width - 4, 88))
    const startLine = 5
    return {
      overlayWidth,
      leftPad: Math.max(0, Math.floor((width - overlayWidth) / 2)),
      startLine,
      maxItems: Math.max(1, Math.min(13, baseLineCount - startLine - 7)),
    }
  }

  protected commitPickerOverlayRow(content: string, overlayWidth: number): string {
    const inner = fit(content, overlayWidth - 2)
    return `${this.theme.fg("border", "│")}${inner}${this.theme.fg("border", "│")}`
  }

  protected commitPickerBorder(edge: "top" | "bottom", overlayWidth: number): string {
    const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"]
    return this.theme.fg("border", `${left}${"─".repeat(overlayWidth - 2)}${right}`)
  }

  protected applyCommitPickerOverlay(
    baseLines: string[],
    overlay: string[],
    layout: { overlayWidth: number; leftPad: number; startLine: number },
    width: number,
  ): string[] {
    const result = [...baseLines]
    for (let index = 0; index < overlay.length; index++) {
      result[layout.startLine + index] = this.mergeOverlayLine(
        result[layout.startLine + index],
        overlay[index] ?? "",
        layout,
        width,
      )
    }
    return result.map((line) => fit(line, width))
  }

  protected mergeOverlayLine(
    baseLine: string | undefined,
    overlayLine: string,
    layout: { overlayWidth: number; leftPad: number },
    width: number,
  ): string {
    const base = baseLine ?? ""
    const prefix = blankStyledColumns(base, 0, layout.leftPad)
    const suffixStart = layout.leftPad + layout.overlayWidth
    const suffixLength = Math.max(0, width - suffixStart)
    const suffix = blankStyledColumns(base, suffixStart, suffixLength)
    return fit(prefix + overlayLine + suffix, width)
  }
}
