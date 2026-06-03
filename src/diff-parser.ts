import type { CommitSummary, DiffDocument, DiffFile, DiffMode, RepositoryState } from "./types.js"

function unquoteGitPath(path: string): string {
  let value = path.trim()
  if (value.startsWith("a/") || value.startsWith("b/")) {
    value = value.slice(2)
  }
  if (value === "/dev/null") {
    return value
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

const DIFF_GIT_LINE = /^diff --git (.+) (.+)$/

function pathFromDiffGit(line: string): string | undefined {
  const match = line.match(DIFF_GIT_LINE)
  if (!match) {
    return
  }
  return unquoteGitPath(match[2] ?? match[1] ?? "")
}

function statusFromLines(lines: string[], oldPath?: string, newPath?: string): DiffFile["status"] {
  if (lines.some((line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))) {
    return "binary"
  }
  if (lines.some((line) => line.startsWith("rename from "))) {
    return "renamed"
  }
  if (lines.some((line) => line.startsWith("copy from "))) {
    return "copied"
  }
  if (oldPath === "/dev/null") {
    return "added"
  }
  if (newPath === "/dev/null") {
    return "deleted"
  }
  return "modified"
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

function diffChunks(lines: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      chunks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

function updateDiffMetadata(metadata: DiffMetadata, line: string): void {
  if (line.startsWith("diff --git ")) {
    metadata.fallbackPath = pathFromDiffGit(line) ?? metadata.fallbackPath
    return
  }
  if (line.startsWith("--- ")) {
    metadata.oldPath = unquoteGitPath(line.slice(4))
    return
  }
  if (line.startsWith("+++ ")) {
    metadata.newPath = unquoteGitPath(line.slice(4))
    return
  }
  if (line.startsWith("rename to ")) {
    metadata.newPath = unquoteGitPath(line.slice("rename to ".length))
    return
  }
  if (line.startsWith("rename from ")) {
    metadata.oldPath = unquoteGitPath(line.slice("rename from ".length))
  }
}

function extractDiffMetadata(lines: string[]): DiffMetadata {
  const metadata: DiffMetadata = {}
  for (const line of lines) {
    updateDiffMetadata(metadata, line)
  }
  return metadata
}

function displayPath(metadata: DiffMetadata): string {
  if (metadata.newPath && metadata.newPath !== "/dev/null") {
    return metadata.newPath
  }
  if (metadata.oldPath && metadata.oldPath !== "/dev/null") {
    return metadata.oldPath
  }
  return metadata.fallbackPath ?? "(unknown)"
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

function parseDiff(raw: string): DiffFile[] {
  return diffChunks(normalizedDiffLines(raw)).map(diffFileFromChunk)
}

export function emptyDocument(
  title: string,
  subtitle: string,
  mode: DiffMode,
  commit?: CommitSummary,
  repositoryState?: RepositoryState,
): DiffDocument {
  return { mode, title, subtitle, raw: "", files: [], commit, repositoryState }
}

export function buildDocument(
  mode: DiffMode,
  title: string,
  subtitle: string,
  raw: string,
  commit?: CommitSummary,
  stagedPaths = new Set<string>(),
  conflictedPaths = new Set<string>(),
  untrackedPaths = new Set<string>(),
): DiffDocument {
  const files = parseDiff(raw).map((file) => ({
    ...file,
    status: conflictedPaths.has(file.path) ? "conflicted" : file.status,
    staged: stagedPaths.has(file.path),
    untracked: untrackedPaths.has(file.path) || undefined,
  }))
  return { mode, title, subtitle, raw, files, commit }
}
