import { parseDiff } from "./diff-parser-core.js"
import type { CommitSummary, DiffDocument, DiffMode, RepositoryState } from "./types.js"

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
