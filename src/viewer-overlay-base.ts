import { blankStyledColumns, copyStyledColumns } from "./ansi-segments.js"
import { fit } from "./render-text.js"
import { DiffViewerFrame } from "./viewer-frame.js"

const OUTER_FRAME_BORDER = "│"

function stripSgr(text: string): string {
  let result = ""
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 0x1b && text[index + 1] === "[") {
      index += 2
      while (index < text.length && text[index] !== "m") {
        index++
      }
    } else {
      result += text[index]
    }
  }
  return result
}

function outerBorderColumn(base: string, column: number, width: number): string | undefined {
  if (column !== 0 && column !== width - 1) {
    return undefined
  }

  const segment = copyStyledColumns(base, column, 1)
  return stripSgr(segment) === OUTER_FRAME_BORDER ? segment : undefined
}

function blankStyledColumnsPreservingOuterBorders(
  base: string,
  startColumn: number,
  length: number,
  width: number,
): string {
  let result = ""
  let blankStart = startColumn
  let blankLength = 0

  const appendBlank = (): void => {
    if (blankLength > 0) {
      result += blankStyledColumns(base, blankStart, blankLength)
      blankStart += blankLength
      blankLength = 0
    }
  }

  for (let offset = 0; offset < length; offset++) {
    const column = startColumn + offset
    const border = outerBorderColumn(base, column, width)
    if (border) {
      appendBlank()
      result += border
      blankStart = column + 1
    } else {
      blankLength++
    }
  }

  appendBlank()
  return result
}

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
    if (width <= 0) {
      return ""
    }

    const base = baseLine ?? ""
    const leftPad = Math.min(width, Math.max(0, layout.leftPad))
    const overlayWidth = Math.min(Math.max(0, layout.overlayWidth), width - leftPad)
    const prefix = blankStyledColumnsPreservingOuterBorders(base, 0, leftPad, width)
    const overlay = fit(overlayLine, overlayWidth)
    const suffixStart = leftPad + overlayWidth
    const suffixLength = Math.max(0, width - suffixStart)
    const suffix = blankStyledColumnsPreservingOuterBorders(base, suffixStart, suffixLength, width)
    return fit(prefix + overlay + suffix, width)
  }
}
