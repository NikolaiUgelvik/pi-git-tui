import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { listStagedFiles } from "./git-file-list-service.js"
import { assertGitSuccess, ensureGitRepository, GitCommandError, git } from "./git-service.js"
import { type GitExecResult, MAX_COMMIT_MESSAGE_DIFF_CHARS } from "./types.js"

export type IndexPathspec = string | readonly string[]

function indexPaths(pathspec: IndexPathspec): string[] {
  const paths = [...new Set(typeof pathspec === "string" ? [pathspec] : pathspec)].filter(Boolean)
  if (paths.length === 0) {
    throw new Error("No file path was selected")
  }
  return paths
}

function displayPath(paths: string[]): string {
  return paths[0] ?? "selected file"
}

async function runFirstSuccessfulIndexCommand(
  pi: ExtensionAPI,
  root: string,
  commands: string[][],
  signal?: AbortSignal,
): Promise<void> {
  let lastFailure: { args: string[]; result: GitExecResult } | undefined
  for (const args of commands) {
    const result = await git(pi, root, args, signal)
    if (result.killed) {
      throw new GitCommandError(result, args, root)
    }
    if (result.code === 0) {
      return
    }
    lastFailure = { args, result }
  }
  if (!lastFailure) {
    throw new Error("No index command was provided")
  }
  throw new GitCommandError(lastFailure.result, lastFailure.args, root)
}

function unstageCommands(paths: string[]): string[][] {
  return [
    ["restore", "--staged", "--", ...paths],
    ["reset", "--", ...paths],
    ["rm", "--cached", "-r", "-f", "--", ...paths],
  ]
}

async function stagePaths(pi: ExtensionAPI, root: string, paths: string[], signal?: AbortSignal): Promise<void> {
  await runFirstSuccessfulIndexCommand(
    pi,
    root,
    [
      ["add", "--all", "--", ...paths],
      ["add", "--update", "--", ...paths],
    ],
    signal,
  )
}

export async function stageRemainingFile(
  pi: ExtensionAPI,
  cwd: string,
  pathspec: IndexPathspec,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const paths = indexPaths(pathspec)
  await stagePaths(pi, root, paths, signal)
  return `Staged remaining changes in ${displayPath(paths)}`
}

export async function unstageFile(
  pi: ExtensionAPI,
  cwd: string,
  pathspec: IndexPathspec,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const paths = indexPaths(pathspec)
  await runFirstSuccessfulIndexCommand(pi, root, unstageCommands(paths), signal)
  return `Unstaged ${displayPath(paths)}`
}

export async function stageAllRemaining(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const args = ["add", "--all"]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
  return "Staged all remaining changes"
}

export async function unstageAll(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  await runFirstSuccessfulIndexCommand(pi, root, unstageCommands(["."]), signal)
  return "Unstaged all changes"
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
  const statArgs = ["diff", "--cached", "--stat", "--color=never"]
  const diffArgs = [
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--find-copies",
    "--color=never",
    "--cached",
    "--",
  ]
  const statResult = await git(pi, root, statArgs, signal)
  const diffResult = await git(pi, root, diffArgs, signal)
  assertGitSuccess(statResult, statArgs, root)
  assertGitSuccess(diffResult, diffArgs, root)
  const diff = [statResult.stdout.trim(), diffResult.stdout.trim()].filter(Boolean).join("\n\n")
  if (!diff) {
    throw new Error("No staged changes to summarize")
  }
  if (diff.length <= MAX_COMMIT_MESSAGE_DIFF_CHARS) {
    return diff
  }
  return `${diff.slice(0, MAX_COMMIT_MESSAGE_DIFF_CHARS)}\n\n[diff truncated]`
}
