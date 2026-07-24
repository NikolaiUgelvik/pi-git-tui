import type { Theme } from "@earendil-works/pi-coding-agent"

export interface BranchSummary {
  name: string
  current: boolean
  upstream?: string
  track?: string
}

export type TagTargetType = "commit" | "tree" | "blob" | "tag" | "unknown"

export interface TagSummary {
  name: string
  annotated: boolean
  targetHash: string
  targetType: TagTargetType
  createdAt?: string
  creator?: string
  annotation?: string
  targetSubject?: string
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

export type DiffOmissionReason =
  | "file-too-large"
  | "file-count-budget"
  | "aggregate-byte-budget"
  | "aggregate-line-budget"
  | "unsupported-file"
  | "changed-during-load"
  | "capture-overflow"

export interface DiffOmission {
  reason: DiffOmissionReason
  measuredBytes?: number
  limitBytes?: number
  measuredLines?: number
  limitLines?: number
  limitFiles?: number
  message: string
}

export type DiffMode = "working" | "commit"
export type DiffScope = "working" | "staged" | "commit"
export type WorkingTreeView = Exclude<DiffScope, "commit">
export type RepositoryState = "ready" | "missing"
export type HeadState = "present" | "unborn"
export type FileStageState = "unstaged" | "staged" | "mixed" | "conflicted"
export type WorkingTreeRefreshScope = "none" | "status" | "full"

export interface CommitSummary {
  hash: string
  message: string
}

export type CommitPickerItem = { type: "working" } | { type: "commit"; commit: CommitSummary }
export type GitCommandRisk = { kind: "normal" } | { kind: "force-push" }

export interface GitCommand {
  readonly label: string
  readonly description: string
  readonly args: readonly string[]
  readonly risk: GitCommandRisk
  readonly refreshDiff?: boolean
  readonly refresh?: {
    readonly success: WorkingTreeRefreshScope
    readonly failure: WorkingTreeRefreshScope
  }
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

export interface WorkingTreeRevision {
  readonly root: string
  readonly statusFingerprint: string
  readonly contentIdentity: string
  readonly clean: boolean
}

export interface DiffFile {
  path: string
  oldPath?: string
  newPath?: string
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary" | "conflicted"
  stageState?: FileStageState
  /** Compatibility metadata used while decorating bounded captures. */
  staged?: boolean
  untracked?: boolean
  untrackedRole?: "replacement" | "rename-source"
  submodule?: string
  lines: string[]
  omission?: DiffOmission
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
  omittedFileCount: number
  capturedPatchBytes: number
  capturedPatchLines: number
}

export interface DiffDocumentBase {
  title: string
  subtitle: string
  repositoryState: RepositoryState
  headState: HeadState
  /** Flat compatibility view used by performance instrumentation. */
  raw: string
  files: DiffFile[]
  omittedFileCount: number
  capturedPatchBytes: number
  capturedPatchLines: number
}

export interface WorkingTreeDocument extends DiffDocumentBase {
  mode: "working"
  working: DiffSlice
  staged: DiffSlice
  revision?: WorkingTreeRevision
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
  | "tagPicker"
  | "stashPicker"
  | "worktreePicker"
  | "settings"
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
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
  {
    label: "Fetch + Prune",
    description: "Fetch the default remote and prune stale remote-tracking refs",
    args: ["fetch", "--prune"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
  {
    label: "Fetch All Remotes",
    description: "Fetch every remote and prune stale remote-tracking refs",
    args: ["fetch", "--all", "--prune"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
  {
    label: "Pull (FF Only)",
    description: "Update the current branch only with a fast-forward",
    args: ["pull", "--ff-only"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "full", failure: "full" },
  },
  {
    label: "Pull",
    description: "Pull updates into the current branch",
    args: ["pull"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "full", failure: "full" },
  },
  {
    label: "Pull (Rebase)",
    description: "Pull updates and rebase local commits",
    args: ["pull", "--rebase"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "full", failure: "full" },
  },
  {
    label: "Update Submodules",
    description: "Initialize and recursively update registered submodules",
    args: ["submodule", "update", "--init", "--recursive"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "full", failure: "full" },
  },
  {
    label: "Push",
    description: "Push the current branch",
    args: ["push"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
  {
    label: "Push Tags",
    description: "Push all local tags to the configured push remote",
    args: ["push", "--tags"],
    risk: { kind: "normal" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
  {
    label: "Force Push",
    description: "Push the current branch with --force-with-lease",
    args: ["push", "--force-with-lease"],
    risk: { kind: "force-push" },
    refreshDiff: true,
    refresh: { success: "status", failure: "status" },
  },
]

export type StashConfirm = "pop" | "drop"
export type ConfirmAction = "init" | "discard"
