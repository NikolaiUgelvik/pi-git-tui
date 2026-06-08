import type { DiffFile } from "./types.js"

function dropDiffSidePrefix(value: string): string {
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value
}

function parseQuotedGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value
  }
  try {
    return JSON.parse(value) as string
  } catch {
    return value.slice(1, -1)
  }
}

function unquoteGitPath(path: string): string {
  const value = dropDiffSidePrefix(path.trim())
  return value === "/dev/null" ? value : parseQuotedGitPath(value)
}

const DIFF_GIT_LINE = /^diff --git (.+) (.+)$/

function pathFromDiffGit(line: string): string | undefined {
  const match = line.match(DIFF_GIT_LINE)
  if (!match) {
    return
  }
  return unquoteGitPath(match[2] ?? match[1] ?? "")
}

function lineHasAnyPrefix(line: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => line.startsWith(prefix))
}

const STATUS_LINE_RULES: Array<{ status: DiffFile["status"]; matches: (line: string) => boolean }> = [
  { status: "binary", matches: (line) => lineHasAnyPrefix(line, ["Binary files ", "GIT binary patch"]) },
  { status: "renamed", matches: (line) => line.startsWith("rename from ") },
  { status: "copied", matches: (line) => line.startsWith("copy from ") },
]

function statusFromPaths(oldPath?: string, newPath?: string): DiffFile["status"] {
  if (oldPath === "/dev/null") {
    return "added"
  }
  return newPath === "/dev/null" ? "deleted" : "modified"
}

function statusFromLines(lines: string[], oldPath?: string, newPath?: string): DiffFile["status"] {
  return STATUS_LINE_RULES.find((rule) => lines.some(rule.matches))?.status ?? statusFromPaths(oldPath, newPath)
}

interface DiffMetadata {
  oldPath?: string
  newPath?: string
  fallbackPath?: string
}

function normalizedDiffLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rawLines = normalized.length > 0 ? normalized.split("\n") : []
  if (rawLines.at(-1) === "") {
    rawLines.pop()
  }
  return rawLines
}

interface DiffChunkState {
  chunks: string[][]
  current: string[]
}

function startsNewDiffChunk(state: DiffChunkState, line: string): boolean {
  return state.current.length > 0 && line.startsWith("diff --git ")
}

function flushCurrentChunk(state: DiffChunkState): void {
  if (state.current.length === 0) {
    return
  }
  state.chunks.push(state.current)
  state.current = []
}

function appendDiffChunkLine(state: DiffChunkState, line: string): void {
  if (startsNewDiffChunk(state, line)) {
    flushCurrentChunk(state)
  }
  state.current.push(line)
}

function diffChunks(lines: string[]): string[][] {
  const state: DiffChunkState = { chunks: [], current: [] }
  lines.forEach((line) => {
    appendDiffChunkLine(state, line)
  })
  flushCurrentChunk(state)
  return state.chunks
}

interface MetadataLineRule {
  prefix: string
  apply: (metadata: DiffMetadata, line: string) => void
}

const METADATA_LINE_RULES: MetadataLineRule[] = [
  {
    prefix: "diff --git ",
    apply: (metadata, line) => {
      metadata.fallbackPath = pathFromDiffGit(line) ?? metadata.fallbackPath
    },
  },
  {
    prefix: "--- ",
    apply: (metadata, line) => {
      metadata.oldPath = unquoteGitPath(line.slice(4))
    },
  },
  {
    prefix: "+++ ",
    apply: (metadata, line) => {
      metadata.newPath = unquoteGitPath(line.slice(4))
    },
  },
  {
    prefix: "rename to ",
    apply: (metadata, line) => {
      metadata.newPath = unquoteGitPath(line.slice("rename to ".length))
    },
  },
  {
    prefix: "rename from ",
    apply: (metadata, line) => {
      metadata.oldPath = unquoteGitPath(line.slice("rename from ".length))
    },
  },
]

function updateDiffMetadata(metadata: DiffMetadata, line: string): void {
  METADATA_LINE_RULES.find((rule) => line.startsWith(rule.prefix))?.apply(metadata, line)
}

function extractDiffMetadata(lines: string[]): DiffMetadata {
  const metadata: DiffMetadata = {}
  for (const line of lines) {
    updateDiffMetadata(metadata, line)
  }
  return metadata
}

function usablePath(path: string | undefined): string | undefined {
  return path !== undefined && path !== "/dev/null" ? path : undefined
}

function displayPath(metadata: DiffMetadata): string {
  return usablePath(metadata.newPath) ?? usablePath(metadata.oldPath) ?? metadata.fallbackPath ?? "(unknown)"
}

function diffFileFromChunk(lines: string[]): DiffFile {
  const metadata = extractDiffMetadata(lines)
  return {
    path: displayPath(metadata),
    oldPath: metadata.oldPath,
    newPath: metadata.newPath,
    status: statusFromLines(lines, metadata.oldPath, metadata.newPath),
    staged: false,
    lines,
  }
}

export function parseDiff(raw: string): DiffFile[] {
  return diffChunks(normalizedDiffLines(raw)).map(diffFileFromChunk)
}
