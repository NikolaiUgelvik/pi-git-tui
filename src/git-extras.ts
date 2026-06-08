import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, compactGitOutput, ensureGitRepository, git, requireGitRepository } from "./git-service.js"
import type { DiffFile, GitExecResult } from "./types.js"

// Re-export from focused service modules
export { createAndSwitchBranch, getBranches as listBranches, switchBranch } from "./git-branch-service.js"
export {
  applyStash,
  dropStash,
  getStashes as listStashes,
  popStash,
  stashCurrentChanges,
} from "./git-stash-service.js"
export { listWorktrees, parseWorktreeList } from "./git-worktree-service.js"
// Re-export types
export type { WorktreeSummary } from "./types.js"

// --- Repository initialization ---

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

// --- Discard operations ---

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  return (await git(pi, cwd, ["rev-parse", "--verify", "HEAD"], signal)).code === 0
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

function discardFailureMessage(primary: GitExecResult, fallback: GitExecResult): string {
  return compactGitOutput(primary) || compactGitOutput(fallback) || "Could not discard changes"
}

function throwOnDiscardFailure(primary: GitExecResult, fallback: GitExecResult): void {
  if (primary.code !== 0) {
    throw new Error(discardFailureMessage(primary, fallback))
  }
}

async function removeNoHeadPaths(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const rmArgs = ["rm", "-f", "--", ...paths]
  throwOnDiscardFailure(await git(pi, root, rmArgs, signal), restoreResult)
}

async function discardWithHeadFallback(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const resetArgs = ["reset", "--", ...paths]
  throwOnDiscardFailure(await git(pi, root, resetArgs, signal), restoreResult)
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
  throw new Error(discardFailureMessage(cleanResult, worktreeResult))
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
