import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildDocument, emptyDocument } from "./diff-parser.js"
import { listStagedFiles, listUntrackedFiles } from "./git-file-list-service.js"
import { ensureGitRepository, git } from "./git-service.js"
import { conflictedPaths, currentBranchStatusLabel } from "./git-status.js"
import type { CommitSummary, DiffDocument } from "./types.js"
import { MAX_UNTRACKED_FILE_BYTES } from "./types.js"

const BASE_DIFF_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-ext-diff",
  "--find-renames",
  "--find-copies",
  "--color=never",
]

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  const result = await git(pi, cwd, ["rev-parse", "--verify", "HEAD"], signal)
  return result.code === 0
}

async function currentBranchLabel(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const branchResult = await git(pi, cwd, ["branch", "--show-current"], signal)
  const branch = branchResult.stdout.trim()
  if (branchResult.code === 0 && branch) {
    return branch
  }

  const headResult = await git(pi, cwd, ["rev-parse", "--short", "HEAD"], signal)
  const head = headResult.stdout.trim()
  if (headResult.code === 0 && head) {
    return `detached ${head}`
  }
}

function repositoryLabel(root: string, branch: string | undefined): string {
  return branch ? `${root} (${branch})` : root
}

function commitSubtitle(root: string, branch: string | undefined, message: string): string {
  const repo = repositoryLabel(root, branch)
  return message ? `${repo} • ${message}` : repo
}

async function readUntrackedDiff(pi: ExtensionAPI, cwd: string, file: string, signal?: AbortSignal): Promise<string> {
  const trackedResult = await git(pi, cwd, ["-c", "core.quotepath=false", "ls-files", "--stage", "--", file], signal)
  if (trackedResult.code === 0 && trackedResult.stdout.trim()) {
    return ""
  }

  const sizeResult = await git(pi, cwd, ["-c", "core.quotepath=false", "cat-file", "-e", `HEAD:${file}`], signal)
  if (sizeResult.code === 0) {
    return ""
  }

  const nodeStat = await stat(resolve(cwd, file)).catch(() => undefined)
  if (!nodeStat?.isFile() || nodeStat.size > MAX_UNTRACKED_FILE_BYTES) {
    return ""
  }

  const result = await git(
    pi,
    cwd,
    ["-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", file],
    signal,
  )
  return result.stdout
}

function workingTreeDiffArgs(headExists: boolean): string[] {
  if (headExists) {
    return [...BASE_DIFF_ARGS, "HEAD", "--"]
  }
  return ["-c", "core.quotepath=false", "diff", "--cached", ...BASE_DIFF_ARGS.slice(3), "--"]
}

async function readUntrackedDiffs(
  pi: ExtensionAPI,
  root: string,
  files: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const diffs = await Promise.all(files.map((file) => readUntrackedDiff(pi, root, file, signal)))
  return diffs.filter((diff) => diff.trim().length > 0)
}

function joinDiffParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n")
}

export async function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionContext): Promise<DiffDocument> {
  const root = await ensureGitRepository(pi, ctx.cwd, ctx.signal)
  if (!root) {
    return emptyDocument("Not a git repository", ctx.cwd, "working", undefined, "missing")
  }

  const [headExists, branch] = await Promise.all([
    hasHead(pi, root, ctx.signal),
    currentBranchLabel(pi, root, ctx.signal),
  ])
  const [diffResult, untracked, stagedFiles, conflicts, branchStatus] = await Promise.all([
    git(pi, root, workingTreeDiffArgs(headExists), ctx.signal),
    listUntrackedFiles(pi, root, ctx.signal),
    listStagedFiles(pi, root, ctx.signal),
    conflictedPaths(pi, root, ctx.signal),
    currentBranchStatusLabel(pi, root, branch, ctx.signal),
  ])
  const untrackedDiffs = await readUntrackedDiffs(pi, root, untracked, ctx.signal)
  const title = headExists ? "Working tree vs HEAD" : "Working tree (no commits yet)"
  return buildDocument(
    "working",
    title,
    repositoryLabel(root, branchStatus),
    joinDiffParts([diffResult.stdout, ...untrackedDiffs]),
    undefined,
    stagedFiles,
    conflicts,
    new Set(untracked),
  )
}

export async function loadCommitDiff(
  pi: ExtensionAPI,
  cwd: string,
  commit: CommitSummary,
  signal?: AbortSignal,
): Promise<DiffDocument> {
  const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd
  const [result, branch] = await Promise.all([
    git(
      pi,
      root,
      [
        "-c",
        "core.quotepath=false",
        "show",
        "--format=",
        "--no-ext-diff",
        "--find-renames",
        "--find-copies",
        "--color=never",
        commit.hash,
        "--",
      ],
      signal,
    ),
    currentBranchLabel(pi, root, signal),
  ])
  return buildDocument(
    "commit",
    `Commit ${commit.hash}`,
    commitSubtitle(root, branch, commit.message),
    result.stdout,
    commit,
  )
}

export async function getStagedDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return ""
  }
  const result = await git(pi, root, [...BASE_DIFF_ARGS, "--cached", "--"], signal)
  if (result.code !== 0) {
    return ""
  }
  return result.stdout
}

export async function getCommitRangeDiff(
  pi: ExtensionAPI,
  cwd: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return ""
  }
  const result = await git(pi, root, [...BASE_DIFF_ARGS, `${from}...${to}`, "--"], signal)
  if (result.code !== 0) {
    return ""
  }
  return result.stdout
}
