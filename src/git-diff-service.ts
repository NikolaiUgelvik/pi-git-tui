import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument, buildWorkingTreeDocument, emptyWorkingTreeDocument } from "./diff-document.js"
import { buildDiffArgs, CANONICAL_PATCH_OPTIONS } from "./git-diff-args.js"
import { captureTrackedDiff, type TrackedDiffCapture } from "./git-diff-capture.js"
import { captureHistoricalDiff } from "./git-historical-diff-capture.js"
import { ensureGitRepository, requireGitRepository, runGit, throwIfGitAborted } from "./git-service.js"
import { loadWorkingTreeSnapshot, type WorkingTreeSnapshot, workingTreeBranchLabel } from "./git-status.js"
import { loadUntrackedDiffs, type UntrackedDiffResult } from "./git-untracked-service.js"
import { linkedAbortController } from "./git-worker-pool.js"
import { workingTreeContentIdentity } from "./git-working-tree-identity.js"
import type {
  CommitDocument,
  CommitSummary,
  DiffFile,
  HeadState,
  WorkingTreeDocument,
  WorkingTreeRevision,
} from "./types.js"

function headState(snapshot: WorkingTreeSnapshot): HeadState {
  return snapshot.head.kind === "initial" ? "unborn" : "present"
}

function repositoryLabel(root: string, branch: string | undefined): string {
  return branch ? `${root} (${branch})` : root
}

export function workingTreeDocumentTitle(snapshot: WorkingTreeSnapshot): string {
  return snapshot.head.kind === "initial" ? "Working tree and index (no commits yet)" : "Working tree and index"
}

export function workingTreeDocumentSubtitle(root: string, snapshot: WorkingTreeSnapshot): string {
  return repositoryLabel(root, workingTreeBranchLabel(snapshot))
}

export function workingTreeRevision(
  root: string,
  snapshot: WorkingTreeSnapshot,
  contentIdentity: string,
): WorkingTreeRevision {
  return { root, statusFingerprint: snapshot.statusFingerprint, contentIdentity, clean: snapshot.clean }
}

function commitSubtitle(root: string, branch: string | undefined, message: string): string {
  const repository = repositoryLabel(root, branch)
  return message ? `${repository} • ${message}` : repository
}

function joinDiffParts(parts: readonly string[]): string {
  return parts.filter(Boolean).join("\n")
}

function untrackedRole(snapshot: WorkingTreeSnapshot, path: string): DiffFile["untrackedRole"] {
  if (snapshot.entries.some((entry) => entry.path === path && entry.indexStatus === "D")) return "replacement"
  if (snapshot.entries.some((entry) => entry.originalPath === path)) return "rename-source"
}

function untrackedOmittedFile(
  result: Extract<UntrackedDiffResult, { kind: "omitted" }>,
  snapshot: WorkingTreeSnapshot,
): DiffFile {
  return {
    path: result.path,
    oldPath: "/dev/null",
    newPath: result.path,
    status: "added",
    staged: false,
    untracked: true,
    ...(untrackedRole(snapshot, result.path) === undefined
      ? {}
      : { untrackedRole: untrackedRole(snapshot, result.path) }),
    lines: [],
    omission: result.omission,
  }
}

const EMPTY_TRACKED_CAPTURE: TrackedDiffCapture = {
  raw: "",
  omittedFiles: [],
  capturedPatchBytes: 0,
  capturedPatchLines: 0,
}

function captureMetrics(capture: TrackedDiffCapture): { bytes: number; lines: number } {
  return { bytes: capture.capturedPatchBytes, lines: capture.capturedPatchLines }
}

function applySnapshotMetadata(files: DiffFile[], snapshot: WorkingTreeSnapshot): void {
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    if (!file) continue
    const aliases = new Set([file.path, file.oldPath, file.newPath].filter((path): path is string => Boolean(path)))
    const entry = snapshot.entries.find(
      (candidate) => aliases.has(candidate.path) || (candidate.originalPath && aliases.has(candidate.originalPath)),
    )
    if (entry?.submodule.startsWith("S")) files[index] = { ...file, submodule: entry.submodule }
  }
}

export async function loadWorkingTreeDiffFromSnapshot(
  pi: ExtensionAPI,
  root: string,
  snapshot: WorkingTreeSnapshot,
  signal?: AbortSignal,
): Promise<WorkingTreeDocument> {
  throwIfGitAborted(signal)
  const hasStaged = snapshot.entries.some((entry) => entry.indexStatus !== "." || entry.kind === "unmerged")
  const hasWorking = snapshot.entries.some((entry) => entry.worktreeStatus !== "." || entry.kind === "unmerged")
  const staged = hasStaged
    ? await captureTrackedDiff(pi, root, snapshot, undefined, signal, "staged")
    : EMPTY_TRACKED_CAPTURE
  throwIfGitAborted(signal)
  const working = hasWorking
    ? await captureTrackedDiff(pi, root, snapshot, undefined, signal, "working")
    : EMPTY_TRACKED_CAPTURE
  throwIfGitAborted(signal)
  const untracked = await loadUntrackedDiffs(pi, root, snapshot, undefined, signal)
  throwIfGitAborted(signal)
  const contentIdentity = await workingTreeContentIdentity(root, snapshot, signal)
  throwIfGitAborted(signal)

  const untrackedPatches = untracked.flatMap((result) => (result.kind === "patch" ? [result.raw] : []))
  const untrackedOmissions = untracked.flatMap((result) =>
    result.kind === "omitted" ? [untrackedOmittedFile(result, snapshot)] : [],
  )
  const document = buildWorkingTreeDocument({
    title: workingTreeDocumentTitle(snapshot),
    subtitle: workingTreeDocumentSubtitle(root, snapshot),
    stagedRaw: staged.raw,
    workingRaw: joinDiffParts([working.raw, ...untrackedPatches]),
    untrackedPaths: snapshot.untrackedPaths,
    conflictedPaths: snapshot.conflictedPaths,
    stagedOmittedFiles: staged.omittedFiles,
    workingOmittedFiles: [...working.omittedFiles, ...untrackedOmissions],
    stagedCapture: captureMetrics(staged),
    workingCapture: {
      bytes:
        working.capturedPatchBytes + untrackedPatches.reduce((total, patch) => total + Buffer.byteLength(patch), 0),
      lines:
        working.capturedPatchLines + untrackedPatches.reduce((total, patch) => total + patch.split("\n").length, 0),
    },
    headState: headState(snapshot),
    revision: workingTreeRevision(root, snapshot, contentIdentity),
  })
  applySnapshotMetadata(document.staged.files, snapshot)
  applySnapshotMetadata(document.working.files, snapshot)
  return document
}

export async function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkingTreeDocument> {
  const linked = linkedAbortController(ctx.signal)
  const signal = linked.controller.signal
  try {
    const [repository, status] = await Promise.allSettled([
      ensureGitRepository(pi, ctx.cwd, signal),
      loadWorkingTreeSnapshot(pi, ctx.cwd, signal),
    ])
    if (repository.status === "rejected") throw repository.reason
    const root = repository.value
    if (!root) return emptyWorkingTreeDocument("Not a git repository", ctx.cwd, "missing")
    if (status.status === "rejected") throw status.reason
    return await loadWorkingTreeDiffFromSnapshot(pi, root, status.value, signal)
  } finally {
    linked.dispose()
  }
}

export const loadWorkingTreeDocument = loadWorkingTreeDiff

export interface CommitDocumentRequest {
  cwd: string
  commit: CommitSummary
  signal?: AbortSignal
}

export async function loadCommitDocument(pi: ExtensionAPI, request: CommitDocumentRequest): Promise<CommitDocument> {
  const root = await requireGitRepository(pi, request.cwd, request.signal)
  const branch = (await runGit(pi, root, ["branch", "--show-current"], { signal: request.signal })).stdout.trim()
  const capture = await captureHistoricalDiff(pi, root, request.commit.hash, undefined, request.signal)
  return buildCommitDocument({
    title: `Commit ${request.commit.hash}`,
    subtitle: commitSubtitle(root, branch || undefined, request.commit.message),
    raw: capture.raw,
    omittedFiles: capture.omittedFiles,
    capture: { bytes: capture.capturedPatchBytes, lines: capture.capturedPatchLines },
    commit: request.commit,
  })
}

export async function getStagedDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  return (await runGit(pi, root, buildDiffArgs({ options: [...CANONICAL_PATCH_OPTIONS, "--cached"] }), { signal }))
    .stdout
}

export async function getCommitRangeDiff(
  pi: ExtensionAPI,
  cwd: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  return (
    await runGit(pi, root, buildDiffArgs({ options: CANONICAL_PATCH_OPTIONS, revisions: [`${from}...${to}`] }), {
      signal,
    })
  ).stdout
}
