import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type DiffFile, GIT_TIMEOUT_MS, type GitExecResult } from "./types.js"

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

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
  return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS })
}

function compactGitOutput(result: GitExecResult): string {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
}

function assertGitSuccess(result: GitExecResult, args: string[]): void {
  if (result.code !== 0) {
    throw new Error(compactGitOutput(result) || `git ${args.join(" ")} failed`)
  }
}

async function ensureGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const result = await git(pi, cwd, ["rev-parse", "--show-toplevel"], signal)
  if (result.code !== 0) {
    return
  }
  return result.stdout.trim()
}

async function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  return root
}

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  return (await git(pi, cwd, ["rev-parse", "--verify", "HEAD"], signal)).code === 0
}

export async function initializeGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const existing = await ensureGitRepository(pi, cwd, signal)
  if (existing) {
    return `Already a git repository: ${existing}`
  }
  const args = ["init"]
  assertGitSuccess(await git(pi, cwd, args, signal), args)
  const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd
  return `Initialized git repository in ${root}`
}

async function selectedFileIsUntracked(
  pi: ExtensionAPI,
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await git(pi, root, ["ls-files", "--others", "--exclude-standard", "-z", "--", path], signal)
  return result.code === 0 && result.stdout.split("\0").filter(Boolean).includes(path)
}

function discardPaths(file: DiffFile): string[] {
  const paths = file.status === "renamed" ? [file.oldPath, file.newPath, file.path] : [file.path]
  return [...new Set(paths.filter((path): path is string => path !== undefined && path !== "/dev/null"))]
}

async function cleanUntrackedPath(pi: ExtensionAPI, root: string, path: string, signal?: AbortSignal): Promise<string> {
  const args = ["clean", "-f", "--", path]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Removed untracked ${path}`
}

async function removeNoHeadPaths(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const rmArgs = ["rm", "-f", "--", ...paths]
  const rmResult = await git(pi, root, rmArgs, signal)
  if (rmResult.code === 0) {
    return
  }
  throw new Error(compactGitOutput(rmResult) || compactGitOutput(restoreResult) || "Could not discard changes")
}

async function discardWithHeadFallback(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const resetArgs = ["reset", "--", ...paths]
  const resetResult = await git(pi, root, resetArgs, signal)
  if (resetResult.code !== 0) {
    throw new Error(compactGitOutput(resetResult) || compactGitOutput(restoreResult) || "Could not discard changes")
  }
  const worktreeArgs = ["restore", "--worktree", "--", ...paths]
  const worktreeResult = await git(pi, root, worktreeArgs, signal)
  if (worktreeResult.code === 0) {
    return
  }
  const cleanArgs = ["clean", "-f", "--", ...paths]
  const cleanResult = await git(pi, root, cleanArgs, signal)
  if (cleanResult.code === 0) {
    return
  }
  throw new Error(compactGitOutput(cleanResult) || compactGitOutput(worktreeResult) || "Could not discard changes")
}

export async function discardFileChanges(
  pi: ExtensionAPI,
  cwd: string,
  file: DiffFile,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  if (file.untracked || (await selectedFileIsUntracked(pi, root, file.path, signal))) {
    return cleanUntrackedPath(pi, root, file.path, signal)
  }

  const paths = discardPaths(file)
  if (paths.length === 0) {
    throw new Error("No selected file path to discard")
  }
  const restoreArgs = ["restore", "--staged", "--worktree", "--", ...paths]
  const restoreResult = await git(pi, root, restoreArgs, signal)
  if (restoreResult.code !== 0) {
    if (await hasHead(pi, root, signal)) {
      await discardWithHeadFallback(pi, root, paths, signal, restoreResult)
    } else {
      await removeNoHeadPaths(pi, root, paths, signal, restoreResult)
    }
  }
  return `Discarded changes in ${file.path}`
}

export async function listBranches(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<BranchSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const format = "%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)"
  const result = await git(pi, root, ["branch", "--format", format], signal)
  assertGitSuccess(result, ["branch", "--format", format])
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", head = "", upstream = "", track = ""] = line.split("\0")
      return { name, current: head.trim() === "*", upstream: upstream || undefined, track: track || undefined }
    })
}

function worktreeBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//u, "")
}

export function parseWorktreeList(output: string): WorktreeSummary[] {
  return output
    .split(/\n\s*\n/u)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const worktree: WorktreeSummary = { path: "" }
      for (const line of record.split("\n")) {
        const [key = "", ...valueParts] = line.split(" ")
        const value = valueParts.join(" ")
        if (key === "worktree") {
          worktree.path = value
        } else if (key === "HEAD") {
          worktree.head = value
        } else if (key === "branch") {
          worktree.branch = worktreeBranchName(value)
        } else if (key === "detached") {
          worktree.detached = true
        } else if (key === "bare") {
          worktree.bare = true
        }
      }
      return worktree
    })
    .filter((worktree) => worktree.path.length > 0)
}

export async function listWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["worktree", "list", "--porcelain"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args)
  return parseWorktreeList(result.stdout)
}

export async function switchBranch(
  pi: ExtensionAPI,
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["switch", branch]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Switched to ${branch}`
}

export async function createAndSwitchBranch(
  pi: ExtensionAPI,
  cwd: string,
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["switch", "-c", name]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Created and switched to ${name}`
}

export async function stashCurrentChanges(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "push", "-u", "-m", "WIP from pi-git"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args)
  return compactGitOutput(result) || "Stashed current changes"
}

export async function listStashes(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<StashSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const result = await git(pi, root, ["stash", "list", "--format=%gd%x00%s"], signal)
  assertGitSuccess(result, ["stash", "list"])
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref = "", message = ""] = line.split("\0")
      return { ref, message }
    })
}

export async function applyStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "apply", ref]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Applied ${ref}`
}

export async function popStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "pop", ref]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Popped ${ref}`
}

export async function dropStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "drop", ref]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Dropped ${ref}`
}
