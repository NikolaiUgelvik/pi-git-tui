import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

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
