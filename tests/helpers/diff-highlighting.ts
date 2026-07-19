import type { Theme } from "@earendil-works/pi-coding-agent"

const ESCAPE = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu")
const foregrounds: Record<string, string> = {
  text: "\x1b[37m",
  toolDiffAdded: "\x1b[32m",
  toolDiffRemoved: "\x1b[31m",
  toolDiffContext: "\x1b[36m",
  accent: "\x1b[35m",
  muted: "\x1b[90m",
  error: "\x1b[91m",
  warning: "\x1b[93m",
  dim: "\x1b[2m",
}
const backgrounds: Record<string, string> = { toolSuccessBg: "\x1b[42m", toolErrorBg: "\x1b[41m" }

export const diffHighlightTheme = {
  fg: (color: string, text: string) => `${foregrounds[color] ?? ""}${text}\x1b[0m`,
  bg: (color: string, text: string) => `${backgrounds[color] ?? ""}${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  getFgAnsi: (color: string) => foregrounds[color] ?? "",
  getBgAnsi: (color: string) => backgrounds[color] ?? "",
} as Theme

export function stripTestAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "")
}

export function testSgrPattern(pattern: string): RegExp {
  return new RegExp(`${ESCAPE}\\[${pattern}`, "u")
}
