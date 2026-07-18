import {
  buildCommitDocument,
  buildWorkingTreeDocument,
  emptyWorkingTreeDocument,
  selectDiffSlice,
} from "./diff-document.js"
import type { CommitSummary, DiffDocument, DiffMode, HeadState, RepositoryState, WorkingTreeDocument } from "./types.js"

export function emptyDocument(
  title: string,
  subtitle: string,
  mode: DiffMode,
  commit?: CommitSummary,
  repositoryState: RepositoryState = "ready",
  headState: HeadState = "present",
): DiffDocument {
  if (mode === "commit") {
    return buildCommitDocument({
      title,
      subtitle,
      raw: "",
      commit: commit ?? { hash: "", message: "" },
      headState,
    })
  }
  return emptyWorkingTreeDocument(title, subtitle, repositoryState, headState)
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
  repositoryState: RepositoryState = "ready",
  headState: HeadState = "present",
): DiffDocument {
  if (mode === "commit") {
    return buildCommitDocument({ title, subtitle, raw, commit: commit ?? { hash: "", message: "" }, headState })
  }
  const document = buildWorkingTreeDocument({
    title,
    subtitle,
    workingRaw: raw,
    stagedRaw: "",
    conflictedPaths,
    untrackedPaths,
    repositoryState,
    headState,
  })
  applyLegacyStagedPaths(document, stagedPaths)
  return document
}

function applyLegacyStagedPaths(document: WorkingTreeDocument, stagedPaths: Set<string>): void {
  if (stagedPaths.size === 0) {
    return
  }
  for (const file of selectDiffSlice(document, "working").files) {
    if (stagedPaths.has(file.path)) {
      file.stageState = "staged"
    }
  }
}
