import type { Theme } from "@earendil-works/pi-coding-agent"

export const COMMIT_LIMIT = 200
export const GIT_TIMEOUT_MS = 10_000
export const MAX_UNTRACKED_FILE_BYTES = 256 * 1024
export const MAX_COMMIT_MESSAGE_DIFF_CHARS = 24_000

export type DiffMode = "working" | "commit"
export type RepositoryState = "ready" | "missing"

export interface CommitSummary {
  hash: string
  message: string
}

export type CommitPickerItem = { type: "working" } | { type: "commit"; commit: CommitSummary }

export interface GitCommand {
  label: string
  description: string
  args: string[]
  refreshDiff: boolean
}

export interface DiffFile {
  path: string
  oldPath?: string
  newPath?: string
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary" | "conflicted"
  staged: boolean
  untracked?: boolean
  lines: string[]
}

export interface DiffDocument {
  mode: DiffMode
  title: string
  subtitle: string
  raw: string
  files: DiffFile[]
  commit?: CommitSummary
  repositoryState?: RepositoryState
}

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
  { label: "Fetch", description: "Fetch updates from the default remote", args: ["fetch"], refreshDiff: true },
  { label: "Pull", description: "Pull updates into the current branch", args: ["pull"], refreshDiff: true },
  {
    label: "Pull (Rebase)",
    description: "Pull updates and rebase local commits",
    args: ["pull", "--rebase"],
    refreshDiff: true,
  },
  { label: "Push", description: "Push the current branch", args: ["push"], refreshDiff: true },
  {
    label: "Force Push",
    description: "Push the current branch with --force-with-lease",
    args: ["push", "--force-with-lease"],
    refreshDiff: true,
  },
]
