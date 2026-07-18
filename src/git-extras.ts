import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { diffFileOperationPaths } from "./diff-document.js"
import {
  assertGitExitCode,
  assertGitSuccess,
  ensureGitRepository,
  GitCommandError,
  git,
  isUnbornHeadResult,
  requireGitRepository,
} from "./git-service.js"
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
  assertGitSuccess(await git(pi, cwd, args, signal), args, cwd)
  const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd
  return `Initialized git repository in ${root}`
}

// --- Discard operations ---

interface DiscardPathClassification {
  head: Set<string>
  index: Set<string>
  untracked: Set<string>
}

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  const args = ["rev-parse", "--verify", "HEAD"]
  const result = await git(pi, cwd, args, signal)
  if (result.code === 0 && !result.killed) {
    return true
  }
  if (isUnbornHeadResult(result)) {
    return false
  }
  assertGitSuccess(result, args, cwd)
  return true
}

function nullDelimitedPaths(output: string): Set<string> {
  return new Set(output.split("\0").filter(Boolean))
}

function indexEntryPaths(output: string): Set<string> {
  const paths = output.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t")
    return separator < 0 ? [] : [entry.slice(separator + 1)]
  })
  return new Set(paths)
}

async function classifyDiscardPaths(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<DiscardPathClassification> {
  const indexArgs = ["-c", "core.quotepath=false", "ls-files", "--stage", "-z", "--", ...paths]
  const untrackedArgs = [
    "-c",
    "core.quotepath=false",
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...paths,
  ]
  const ignoredArgs = [
    "-c",
    "core.quotepath=false",
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
    "--",
    ...paths,
  ]
  const indexResult = await git(pi, root, indexArgs, signal)
  const untrackedResult = await git(pi, root, untrackedArgs, signal)
  const ignoredResult = await git(pi, root, ignoredArgs, signal)
  assertGitSuccess(indexResult, indexArgs, root)
  assertGitSuccess(untrackedResult, untrackedArgs, root)
  assertGitSuccess(ignoredResult, ignoredArgs, root)

  const head = new Set<string>()
  if (await hasHead(pi, root, signal)) {
    const headArgs = ["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...paths]
    const headResult = await git(pi, root, headArgs, signal)
    assertGitSuccess(headResult, headArgs, root)
    for (const path of nullDelimitedPaths(headResult.stdout)) {
      head.add(path)
    }
  }
  return {
    head,
    index: indexEntryPaths(indexResult.stdout),
    untracked: new Set([...nullDelimitedPaths(untrackedResult.stdout), ...nullDelimitedPaths(ignoredResult.stdout)]),
  }
}

async function pathExists(root: string, path: string): Promise<boolean> {
  try {
    await lstat(resolve(root, path))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false
    }
    throw error
  }
}

async function restoreHeadPaths(pi: ExtensionAPI, root: string, paths: string[], signal?: AbortSignal): Promise<void> {
  if (paths.length === 0) {
    return
  }
  const args = ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
}

async function removeIndexOnlyPaths(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (paths.length === 0) {
    return
  }
  const args = ["rm", "--cached", "-r", "-f", "--", ...paths]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
}

async function cleanUntrackedPaths(
  pi: ExtensionAPI,
  root: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (paths.length === 0) {
    return
  }
  const args = ["clean", "-f", "-d", "-x", "--", ...paths]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
}

function assertNoDiff(result: GitExecResult, args: string[], root: string, kind: string): void {
  assertGitExitCode(result, args, [0, 1], root)
  if (result.code === 1) {
    throw new GitCommandError(
      { ...result, stderr: result.stderr || `${kind} changes remain after discard` },
      args,
      root,
    )
  }
}

async function verifyDiscard(
  pi: ExtensionAPI,
  root: string,
  aliases: string[],
  cleanedPaths: string[],
  signal?: AbortSignal,
): Promise<void> {
  const stagedArgs = ["diff", "--cached", "--quiet", "--", ...aliases]
  const workingArgs = ["diff", "--quiet", "--", ...aliases]
  assertNoDiff(await git(pi, root, stagedArgs, signal), stagedArgs, root, "Staged")
  assertNoDiff(await git(pi, root, workingArgs, signal), workingArgs, root, "Working-tree")
  for (const path of cleanedPaths) {
    if (await pathExists(root, path)) {
      throw new Error(`Untracked path remains after discard: ${path}`)
    }
  }
}

export async function discardFileChanges(
  pi: ExtensionAPI,
  cwd: string,
  file: DiffFile,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const aliases = diffFileOperationPaths(file)
  if (aliases.length === 0) {
    throw new Error("No selected file path to discard")
  }

  const classification = await classifyDiscardPaths(pi, root, aliases, signal)
  const headPaths = aliases.filter((path) => classification.head.has(path))
  const indexOnlyPaths = aliases.filter((path) => classification.index.has(path) && !classification.head.has(path))
  await restoreHeadPaths(pi, root, headPaths, signal)
  await removeIndexOnlyPaths(pi, root, indexOnlyPaths, signal)

  const cleanablePaths: string[] = []
  for (const path of aliases) {
    if (
      !classification.head.has(path) &&
      (classification.untracked.has(path) || classification.index.has(path) || (await pathExists(root, path)))
    ) {
      cleanablePaths.push(path)
    }
  }
  await cleanUntrackedPaths(pi, root, cleanablePaths, signal)
  await verifyDiscard(pi, root, aliases, cleanablePaths, signal)
  return `Discarded changes in ${file.path}`
}
