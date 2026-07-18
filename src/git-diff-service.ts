import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument, buildWorkingTreeDocument, emptyWorkingTreeDocument } from "./diff-document.js"
import { listUntrackedFiles } from "./git-file-list-service.js"
import { assertGitSuccess, ensureGitRepository, git, isUnbornHeadResult, requireGitRepository } from "./git-service.js"
import { conflictedPaths, currentBranchStatusLabel } from "./git-status.js"
import type { CommitDocument, CommitSummary, HeadState, WorkingTreeDocument } from "./types.js"
import { readUntrackedDiffPreviews } from "./untracked-preview-service.js"

const BASE_DIFF_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-ext-diff",
  "--find-renames",
  "--find-copies",
  "--color=never",
]

async function loadHeadState(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<HeadState> {
  const args = ["rev-parse", "--verify", "HEAD"]
  const result = await git(pi, cwd, args, signal)
  if (result.code === 0 && !result.killed) {
    return "present"
  }
  if (isUnbornHeadResult(result)) {
    return "unborn"
  }
  assertGitSuccess(result, args, cwd)
  return "present"
}

async function currentBranchLabel(
  pi: ExtensionAPI,
  cwd: string,
  headState: HeadState,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const branchArgs = ["branch", "--show-current"]
  const branchResult = await git(pi, cwd, branchArgs, signal)
  assertGitSuccess(branchResult, branchArgs, cwd)
  const branch = branchResult.stdout.trim()
  if (branch) {
    return branch
  }
  if (headState === "unborn") {
    return
  }

  const headArgs = ["rev-parse", "--short", "HEAD"]
  const headResult = await git(pi, cwd, headArgs, signal)
  assertGitSuccess(headResult, headArgs, cwd)
  const head = headResult.stdout.trim()
  if (!head) {
    throw new Error("git rev-parse returned an empty detached HEAD")
  }
  return `detached ${head}`
}

function repositoryLabel(root: string, branch: string | undefined): string {
  return branch ? `${root} (${branch})` : root
}

function commitSubtitle(root: string, branch: string | undefined, message: string): string {
  const repo = repositoryLabel(root, branch)
  return message ? `${repo} • ${message}` : repo
}

function joinDiffParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n")
}

function stagedDiffArgs(): string[] {
  return [...BASE_DIFF_ARGS, "--cached", "--"]
}

function workingDiffArgs(): string[] {
  return [...BASE_DIFF_ARGS, "--"]
}

export async function loadWorkingTreeDocument(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkingTreeDocument> {
  const root = await ensureGitRepository(pi, ctx.cwd, ctx.signal)
  if (!root) {
    return emptyWorkingTreeDocument("Not a git repository", ctx.cwd, "missing")
  }

  const headState = await loadHeadState(pi, root, ctx.signal)
  const branch = await currentBranchLabel(pi, root, headState, ctx.signal)
  const stagedArgs = stagedDiffArgs()
  const workingArgs = workingDiffArgs()
  const [stagedResult, workingResult, untracked, conflicts, branchStatus] = await Promise.all([
    git(pi, root, stagedArgs, ctx.signal),
    git(pi, root, workingArgs, ctx.signal),
    listUntrackedFiles(pi, root, ctx.signal),
    conflictedPaths(pi, root, ctx.signal),
    headState === "unborn" ? Promise.resolve(branch) : currentBranchStatusLabel(pi, root, branch, ctx.signal),
  ])
  assertGitSuccess(stagedResult, stagedArgs, root)
  assertGitSuccess(workingResult, workingArgs, root)
  const untrackedDiffs = await readUntrackedDiffPreviews(pi, root, untracked, headState, ctx.signal)
  const includedUntracked = untrackedDiffs.filter((preview) => preview.include)
  const title = headState === "present" ? "Working tree and index" : "Working tree and index (no commits yet)"
  return buildWorkingTreeDocument({
    title,
    subtitle: repositoryLabel(root, branchStatus),
    stagedRaw: stagedResult.stdout,
    workingRaw: joinDiffParts([workingResult.stdout, ...includedUntracked.map((preview) => preview.raw)]),
    untrackedPaths: includedUntracked.map((preview) => preview.path),
    conflictedPaths: conflicts,
    headState,
  })
}

export interface CommitDocumentRequest {
  cwd: string
  commit: CommitSummary
  signal?: AbortSignal
}

export async function loadCommitDocument(pi: ExtensionAPI, request: CommitDocumentRequest): Promise<CommitDocument> {
  const root = await requireGitRepository(pi, request.cwd, request.signal)
  const headState = await loadHeadState(pi, root, request.signal)
  const branch = await currentBranchLabel(pi, root, headState, request.signal)
  const args = [
    "-c",
    "core.quotepath=false",
    "show",
    "--format=",
    "--no-ext-diff",
    "--find-renames",
    "--find-copies",
    "--color=never",
    request.commit.hash,
    "--",
  ]
  const result = await git(pi, root, args, request.signal)
  assertGitSuccess(result, args, root)
  return buildCommitDocument({
    title: `Commit ${request.commit.hash}`,
    subtitle: commitSubtitle(root, branch, request.commit.message),
    raw: result.stdout,
    commit: request.commit,
    headState,
  })
}

export async function getStagedDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = stagedDiffArgs()
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return result.stdout
}

export async function getCommitRangeDiff(
  pi: ExtensionAPI,
  cwd: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = [...BASE_DIFF_ARGS, `${from}...${to}`, "--"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return result.stdout
}
