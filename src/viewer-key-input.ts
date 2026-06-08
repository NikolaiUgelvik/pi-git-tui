import { matchesKey } from "@earendil-works/pi-tui"

export function isViewerKey(data: string, key: string): boolean {
  return data === key || data === key.toUpperCase()
}

export function isHelpKey(data: string): boolean {
  return data === "?"
}

export function isHelpCloseInput(data: string): boolean {
  return isHelpKey(data) || matchesKey(data, "escape") || isViewerKey(data, "q")
}

export function isEnterInput(data: string): boolean {
  return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n"
}

export function isShiftEnterInput(data: string): boolean {
  return matchesKey(data, "shift+enter") || data === "\x1b[13;2u"
}

export function isPageUpInput(data: string): boolean {
  return matchesKey(data, "pageUp") || data === "\x1b[5~"
}

export function isPageDownInput(data: string): boolean {
  return matchesKey(data, "pageDown") || data === "\x1b[6~"
}

export function arrowScrollDelta(data: string): number {
  if (matchesKey(data, "up") || isViewerKey(data, "k")) {
    return -1
  }
  return matchesKey(data, "down") || isViewerKey(data, "j") ? 1 : 0
}

export function isPrintableInput(data: string): boolean {
  if (data.length === 0 || data.includes("\x1b")) {
    return false
  }
  return [...data].every((char) => {
    const codePoint = char.codePointAt(0)
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
  })
}
