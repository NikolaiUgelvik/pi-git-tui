import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g")

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "")
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text))
  return text + " ".repeat(padding)
}

export function fit(text: string, width: number): string {
  if (width <= 0) {
    return ""
  }
  // Raw git diffs can contain tabs. Terminals expand tabs to multiple cells,
  // while string-width helpers can undercount them, so normalize before sizing.
  const normalized = text.replace(/\t/g, "    ")
  return padToWidth(truncateToWidth(normalized, width, "…"), width)
}
