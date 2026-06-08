import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { listStagedFiles, listUntrackedFiles } from "./git-file-list-service.js"
import { assertGitSuccess, compactGitOutput, ensureGitRepository, git } from "./git-service.js"
import { type GitExecResult, MAX_COMMIT_MESSAGE_DIFF_CHARS } from "./types.js"

async function hasStagedChanges(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<boolean> {
  const result = await git(pi, cwd, ["diff", "--cached", "--quiet", "--", path], signal)
  if (result.code > 1) {
    throw new Error(compactGitOutput(result) || `git diff --cached failed for ${path}`)
  }
  return result.code === 1
}

async function unstageFile(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<void> {
  const restoreArgs = ["restore", "--staged", "--", path]
  const restoreResult = await git(pi, cwd, restoreArgs, signal)
  if (restoreResult.code === 0) {
    return
  }
  await unstageFileWithoutHead(pi, cwd, path, signal, restoreResult)
}

async function unstageFileWithoutHead(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const resetArgs = ["reset", "--", path]
  const resetResult = await git(pi, cwd, resetArgs, signal)
  if (resetResult.code === 0) {
    return
  }
  const rmCachedArgs = ["rm", "--cached", "--", path]
  const rmCachedResult = await git(pi, cwd, rmCachedArgs, signal)
  if (rmCachedResult.code === 0) {
    return
  }
  throw new Error(compactGitOutput(rmCachedResult) || compactGitOutput(resetResult) || compactGitOutput(restoreResult))
}

async function allChangesAreStaged(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<boolean> {
  const stagedFiles = await listStagedFiles(pi, root, signal)
  if (stagedFiles.size === 0) {
    return false
  }
  const unstagedResult = await git(pi, root, ["diff", "--quiet", "--"], signal)
  if (unstagedResult.code > 1) {
    throw new Error(compactGitOutput(unstagedResult) || "git diff --quiet failed")
  }
  const untrackedFiles = await listUntrackedFiles(pi, root, signal)
  return unstagedResult.code === 0 && untrackedFiles.length === 0
}

async function unstageAllChanges(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<string> {
  const restoreArgs = ["restore", "--staged", "--", "."]
  const restoreResult = await git(pi, root, restoreArgs, signal)
  if (restoreResult.code === 0) {
    return "Unstaged all changes"
  }
  const resetArgs = ["reset", "--", "."]
  const resetResult = await git(pi, root, resetArgs, signal)
  if (resetResult.code === 0) {
    return "Unstaged all changes"
  }
  throw new Error(compactGitOutput(resetResult) || compactGitOutput(restoreResult) || "Could not unstage changes")
}

export async function stageOrUnstageFile(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  if (await hasStagedChanges(pi, root, path, signal)) {
    await unstageFile(pi, root, path, signal)
    return `Unstaged ${path}`
  }
  const addArgs = ["add", "--", path]
  assertGitSuccess(await git(pi, root, addArgs, signal), addArgs)
  return `Staged ${path}`
}

export async function toggleAllChangesStaged(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  if (await allChangesAreStaged(pi, root, signal)) {
    return unstageAllChanges(pi, root, signal)
  }
  const args = ["add", "--all"]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return "Staged all changes"
}

export async function getStagedPaths(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return new Set()
  }
  return listStagedFiles(pi, root, signal)
}

export async function stagedDiffForCommitMessage(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const statResult = await git(pi, root, ["diff", "--cached", "--stat", "--color=never"], signal)
  const diffResult = await git(
    pi,
    root,
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--color=never",
      "--cached",
      "--",
    ],
    signal,
  )
  assertGitSuccess(statResult, ["diff", "--cached", "--stat", "--color=never"])
  assertGitSuccess(diffResult, ["diff", "--cached", "--"])
  const diff = [statResult.stdout.trim(), diffResult.stdout.trim()].filter(Boolean).join("\n\n")
  if (!diff) {
    throw new Error("No staged changes to summarize")
  }
  if (diff.length <= MAX_COMMIT_MESSAGE_DIFF_CHARS) {
    return diff
  }
  return `${diff.slice(0, MAX_COMMIT_MESSAGE_DIFF_CHARS)}\n\n[diff truncated]`
}
