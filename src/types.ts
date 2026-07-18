import type { Theme } from "@earendil-works/pi-coding-agent"

export interface BranchSummary {
  name: string
  current: boolean
  upstream?: string
  track?: string
}

export interface StashSummary {
  ref: string
  message: string
}

export interface WorktreeSummary {
  path: string
  head?: string
  branch?: string
  detached?: boolean
  bare?: boolean
}

export const COMMIT_LIMIT = 200
export const GIT_TIMEOUT_MS = 10_000
export const COMMIT_MESSAGE_TIMEOUT_MS = 60_000
export const MAX_UNTRACKED_FILE_BYTES = 256 * 1024
export const MAX_UNTRACKED_PREVIEW_CONCURRENCY = 4
export const MAX_UNTRACKED_PREVIEW_FILES = 100
export const MAX_UNTRACKED_PREVIEW_BYTES = 1024 * 1024
export const MAX_COMMIT_MESSAGE_DIFF_CHARS = 24_000

export type DiffMode = "working" | "commit"
export type DiffScope = "working" | "staged" | "commit"
export type WorkingTreeView = Exclude<DiffScope, "commit">
export type RepositoryState = "ready" | "missing"
export type HeadState = "present" | "unborn"
export type FileStageState = "unstaged" | "staged" | "mixed" | "conflicted"

export interface CommitSummary {
  hash: string
  message: string
}

export type CommitPickerItem = { type: "working" } | { type: "commit"; commit: CommitSummary }

export type GitCommandRisk = { kind: "normal" } | { kind: "force-push" }

export interface GitCommand {
  label: string
  description: string
  args: string[]
  refreshDiff: boolean
  risk: GitCommandRisk
}

export interface PushPreviewUpdate {
  flag: string
  source: string
  destination: string
  summary: string
}

export interface ForcePushPreview {
  command: string
  destination: string
  updates: PushPreviewUpdate[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  newPath?: string
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary" | "conflicted"
  stageState?: FileStageState
  untracked?: boolean
  lines: string[]
}

export interface DiffStats {
  files: number
  additions: number
  deletions: number
}

export interface DiffSlice {
  scope: DiffScope
  raw: string
  files: DiffFile[]
  stats: DiffStats
}

export interface DiffDocumentBase {
  title: string
  subtitle: string
  repositoryState: RepositoryState
  headState: HeadState
}

export interface WorkingTreeDocument extends DiffDocumentBase {
  mode: "working"
  working: DiffSlice
  staged: DiffSlice
}

export interface CommitDocument extends DiffDocumentBase {
  mode: "commit"
  diff: DiffSlice
  commit: CommitSummary
}

export type DiffDocument = WorkingTreeDocument | CommitDocument

export interface GitExecResult {
  stdout: string
  stderr: string
  code: number
  killed: boolean
}

export type FocusPanel = "tree" | "diff"
export type HelpContext =
  | "viewer"
  | "commitPicker"
  | "commandMenu"
  | "commitDialog"
  | "confirmDialog"
  | "branchPicker"
  | "stashPicker"
  | "worktreePicker"
export type ThemeColor = Parameters<Theme["fg"]>[0]

export const TREE_STATUS_COLORS: Record<DiffFile["status"], ThemeColor> = {
  added: "success",
  deleted: "error",
  renamed: "warning",
  copied: "warning",
  binary: "muted",
  conflicted: "warning",
  modified: "text",
}

export const GIT_COMMANDS: GitCommand[] = [
  {
    label: "Fetch",
    description: "Fetch updates from the default remote",
    args: ["fetch"],
    refreshDiff: true,
    risk: { kind: "normal" },
  },
  {
    label: "Pull",
    description: "Pull updates into the current branch",
    args: ["pull"],
    refreshDiff: true,
    risk: { kind: "normal" },
  },
  {
    label: "Pull (Rebase)",
    description: "Pull updates and rebase local commits",
    args: ["pull", "--rebase"],
    refreshDiff: true,
    risk: { kind: "normal" },
  },
  {
    label: "Push",
    description: "Push the current branch",
    args: ["push"],
    refreshDiff: true,
    risk: { kind: "normal" },
  },
  {
    label: "Force Push",
    description: "Push the current branch with --force-with-lease",
    args: ["push", "--force-with-lease"],
    refreshDiff: true,
    risk: { kind: "force-push" },
  },
]

// --- Viewer action types ---

/** Stash confirmation action choice. */
export type StashConfirm = "pop" | "drop"

/** Confirmation dialog action choice. */
export type ConfirmAction = "init" | "discard"
