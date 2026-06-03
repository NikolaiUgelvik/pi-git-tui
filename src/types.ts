import type { Theme } from "@earendil-works/pi-coding-agent"

export const MAX_VIEW_HEIGHT = 34
export const COMMIT_LIMIT = 200
export const GIT_TIMEOUT_MS = 10_000
export const MAX_UNTRACKED_FILE_BYTES = 256 * 1024
export const MAX_COMMIT_MESSAGE_DIFF_CHARS = 24_000

export type DiffMode = "working" | "commit"

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
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary"
  staged: boolean
  lines: string[]
}

export interface DiffDocument {
  mode: DiffMode
  title: string
  subtitle: string
  raw: string
  files: DiffFile[]
  commit?: CommitSummary
}

export interface GitExecResult {
  stdout: string
  stderr: string
  code: number
  killed: boolean
}

export type FocusPanel = "tree" | "diff"
export type HelpContext = "viewer" | "commitPicker" | "commandMenu" | "commitDialog"
export type ThemeColor = Parameters<Theme["fg"]>[0]

export const TREE_STATUS_COLORS: Record<DiffFile["status"], ThemeColor> = {
  added: "success",
  deleted: "error",
  renamed: "warning",
  copied: "warning",
  binary: "muted",
  modified: "text",
}

export const GIT_COMMANDS: GitCommand[] = [
  { label: "Fetch", description: "Fetch updates from the default remote", args: ["fetch"], refreshDiff: false },
  { label: "Pull", description: "Pull updates into the current branch", args: ["pull"], refreshDiff: true },
  {
    label: "Pull (Rebase)",
    description: "Pull updates and rebase local commits",
    args: ["pull", "--rebase"],
    refreshDiff: true,
  },
  { label: "Push", description: "Push the current branch", args: ["push"], refreshDiff: false },
  {
    label: "Force Push",
    description: "Push the current branch with --force-with-lease",
    args: ["push", "--force-with-lease"],
    refreshDiff: false,
  },
]
