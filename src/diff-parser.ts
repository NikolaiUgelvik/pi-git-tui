import { parseDiff } from "./diff-parser-core.js"
import { textLineCount, utf8Bytes } from "./git-patch.js"
import type { CommitSummary, DiffDocument, DiffMode, RepositoryState } from "./types.js"

export function emptyDocument(
  title: string,
  subtitle: string,
  mode: DiffMode,
  commit?: CommitSummary,
  repositoryState?: RepositoryState,
): DiffDocument {
  return {
    mode,
    title,
    subtitle,
    raw: "",
    files: [],
    omittedFileCount: 0,
    capturedPatchBytes: 0,
    capturedPatchLines: 0,
    commit,
    repositoryState,
  }
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
  const files = parseDiff(raw).map((file) => {
    const untracked = untrackedPaths.has(file.path)
    return {
      ...file,
      status: conflictedPaths.has(file.path)
        ? "conflicted"
        : untracked && file.status === "modified"
          ? "added"
          : file.status,
      staged: stagedPaths.has(file.path),
      untracked: untracked || undefined,
    }
  })
  return {
    mode,
    title,
    subtitle,
    raw,
    files,
    omittedFileCount: 0,
    capturedPatchBytes: utf8Bytes(raw),
    capturedPatchLines: textLineCount(raw),
    commit,
  }
}
