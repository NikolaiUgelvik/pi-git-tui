import type { ThemeColor } from "./types.js"

export interface DiffLineStyleRule {
  matches: (line: string) => boolean
  color: ThemeColor
  bold?: boolean
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++")
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---")
}

function isDiffTitleLine(line: string): boolean {
  return line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---")
}

function isDiffMetadataLine(line: string): boolean {
  return ["index ", "new file", "deleted file", "similarity ", "rename "].some((prefix) => line.startsWith(prefix))
}

export const DIFF_LINE_STYLE_RULES: DiffLineStyleRule[] = [
  { matches: isAddedDiffLine, color: "toolDiffAdded" },
  { matches: isRemovedDiffLine, color: "toolDiffRemoved" },
  { matches: (line) => line.startsWith("@@"), color: "accent" },
  { matches: isDiffTitleLine, color: "toolTitle", bold: true },
  { matches: isDiffMetadataLine, color: "muted" },
]
