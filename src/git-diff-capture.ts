import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DEFAULT_TRACKED_DIFF_BUDGET, type TrackedDiffBudget } from "./diff-budgets.js"
import { parseDiff } from "./diff-parser-core.js"
import { type GitFileState, loadGitFileState, sameGitFileState } from "./git-file-state.js"
import {
  type IndexPathSizes,
  loadHeadPathSizes,
  loadIndexPathIdentity,
  loadIndexPathSizes,
} from "./git-object-sizes.js"
import { splitGitPatch, textLineCount, utf8Bytes } from "./git-patch.js"
import { chunkLiteralPathGroups } from "./git-path-batches.js"
import { runGit, throwIfGitAborted } from "./git-service.js"
import type { WorkingTreeSnapshot } from "./git-status.js"
import { retainTrackedPatchChunks, type TrackedPatchChunk } from "./git-tracked-retention.js"
import {
  omittedTrackedGroup,
  type SelectedGroup,
  selectTrackedGroups,
  type TrackedGroup,
  trackedGroups,
} from "./git-tracked-selection.js"
import { mapGitWorkers } from "./git-worker-pool.js"
import type { DiffFile } from "./types.js"

export interface TrackedDiffCapture {
  readonly raw: string
  readonly omittedFiles: readonly DiffFile[]
  readonly capturedPatchBytes: number
  readonly capturedPatchLines: number
}

export type TrackedDiffCaptureScope = "combined" | "staged" | "working"

const BASE_DIFF_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules=none",
  "--find-renames",
  "--find-copies",
  "--color=never",
] as const

async function loadFileStates(
  root: string,
  paths: readonly string[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<Map<string, GitFileState>> {
  const states = await mapGitWorkers(
    paths,
    concurrency,
    async (path, _index, workerSignal) => {
      throwIfGitAborted(workerSignal)
      const state = await loadGitFileState(root, path)
      throwIfGitAborted(workerSignal)
      return state
    },
    signal,
  )
  return new Map(paths.map((path, index) => [path, states[index] ?? { kind: "missing" }]))
}

function cleanSnapshotProbeArgs(snapshot: WorkingTreeSnapshot, scope: TrackedDiffCaptureScope): string[] {
  if (scope === "working") return ["diff", "--quiet", "--"]
  if (scope === "staged") {
    return snapshot.head.kind === "initial"
      ? ["diff", "--cached", "--quiet", "--"]
      : ["diff", "--cached", "--quiet", snapshot.head.oid, "--"]
  }
  return snapshot.head.kind === "initial"
    ? ["diff", "--cached", "--quiet", "--"]
    : ["diff", "--quiet", snapshot.head.oid, "--"]
}

function workingTreeDiffArgs(
  snapshot: WorkingTreeSnapshot,
  paths: readonly string[] | undefined,
  scope: TrackedDiffCaptureScope,
): string[] {
  const literal = paths ? ["--literal-pathspecs"] : []
  const pathArgs = ["--", ...(paths ?? [])]
  if (scope === "working") return [...literal, ...BASE_DIFF_ARGS, ...pathArgs]
  if (scope === "staged") {
    const revision = snapshot.head.kind === "initial" ? [] : [snapshot.head.oid]
    return [...literal, ...BASE_DIFF_ARGS, "--cached", ...revision, ...pathArgs]
  }
  if (snapshot.head.kind !== "initial") {
    return [...literal, ...BASE_DIFF_ARGS, snapshot.head.oid, ...pathArgs]
  }
  return [...literal, ...BASE_DIFF_ARGS, "--cached", ...pathArgs]
}

function scopedSnapshot(snapshot: WorkingTreeSnapshot, scope: TrackedDiffCaptureScope): WorkingTreeSnapshot {
  if (scope === "combined") return snapshot
  const entries = snapshot.entries.filter((entry) =>
    scope === "staged"
      ? entry.indexStatus !== "." || entry.kind === "unmerged"
      : entry.worktreeStatus !== "." || entry.kind === "unmerged",
  )
  return {
    ...snapshot,
    entries,
    stagedPaths: scope === "staged" ? snapshot.stagedPaths : new Set<string>(),
    untrackedPaths: [],
    clean: entries.length === 0,
  }
}

function changedGroups(
  selected: readonly SelectedGroup[],
  before: ReadonlyMap<string, GitFileState>,
  after: ReadonlyMap<string, GitFileState>,
): Set<number> {
  const changed = new Set<number>()
  for (const group of selected) {
    if (
      group.paths.some(
        (path) => !sameGitFileState(before.get(path) ?? { kind: "missing" }, after.get(path) ?? { kind: "missing" }),
      )
    ) {
      changed.add(group.index)
    }
  }
  return changed
}

function indexGroupsByPath(groups: readonly TrackedGroup[]): Map<string, readonly number[]> {
  const indexes = new Map<string, number[]>()
  for (const group of groups) {
    for (const path of group.paths) {
      const pathIndexes = indexes.get(path) ?? []
      pathIndexes.push(group.index)
      indexes.set(path, pathIndexes)
    }
  }
  return indexes
}

function groupIndexesForFile(file: DiffFile, groupsByPath: ReadonlyMap<string, readonly number[]>): number[] {
  const paths = [file.path, file.oldPath, file.newPath].filter((path): path is string => path !== undefined)
  return [...new Set(paths.flatMap((path) => groupsByPath.get(path) ?? []))].sort((left, right) => left - right)
}

function patchChunks(raw: string, groupsByPath: ReadonlyMap<string, readonly number[]>): TrackedPatchChunk[] {
  return splitGitPatch(raw).chunks.map((chunk) => {
    const file = parseDiff(chunk)[0] ?? { path: "(unknown)", status: "modified", staged: false, lines: [] }
    return {
      raw: chunk,
      file,
      groupIndexes: groupIndexesForFile(file, groupsByPath),
      bytes: utf8Bytes(chunk),
      lines: textLineCount(chunk),
    }
  })
}

function emptyTrackedCapture(omissions: ReadonlyMap<number, DiffFile>): TrackedDiffCapture {
  const omittedFiles = [...omissions.entries()].sort(([left], [right]) => left - right).map(([, file]) => file)
  return { raw: "", omittedFiles, capturedPatchBytes: 0, capturedPatchLines: 0 }
}

interface TrackedSelectionPhase {
  readonly selected: readonly SelectedGroup[]
  readonly paths: readonly string[]
  readonly indexSizes?: IndexPathSizes
  readonly checkFileStates: boolean
  readonly before: ReadonlyMap<string, GitFileState>
}

interface TrackedPatchPhase {
  readonly raw: string
  readonly capturable: readonly SelectedGroup[]
  readonly after: ReadonlyMap<string, GitFileState>
}

function recordArgumentOmissions(
  groups: readonly TrackedGroup[],
  snapshot: WorkingTreeSnapshot,
  omissions: Map<number, DiffFile>,
): void {
  for (const group of groups) {
    omissions.set(
      group.index,
      omittedTrackedGroup(group, snapshot, "capture-overflow", {
        detail: "The connected path group exceeds the configured Git argument limit.",
      }),
    )
  }
}

function argumentEligibleGroups(
  groups: readonly TrackedGroup[],
  snapshot: WorkingTreeSnapshot,
  budget: TrackedDiffBudget,
  omissions: Map<number, DiffFile>,
  scope: TrackedDiffCaptureScope,
): TrackedGroup[] {
  const chunks = chunkLiteralPathGroups(
    groups.map((group) => ({ value: group, paths: group.paths })),
    budget,
    workingTreeDiffArgs(snapshot, [], scope),
  )
  recordArgumentOmissions(chunks.oversized, snapshot, omissions)
  return chunks.batches.flat()
}

async function prepareTrackedSelection(
  pi: ExtensionAPI,
  root: string,
  snapshot: WorkingTreeSnapshot,
  groups: readonly TrackedGroup[],
  budget: TrackedDiffBudget,
  omissions: Map<number, DiffFile>,
  scope: TrackedDiffCaptureScope,
  signal?: AbortSignal,
): Promise<TrackedSelectionPhase> {
  const candidates = groups.slice(0, Math.max(0, budget.maxFiles))
  for (const group of groups.slice(candidates.length)) {
    omissions.set(
      group.index,
      omittedTrackedGroup(group, snapshot, "file-count-budget", { limitFiles: budget.maxFiles }),
    )
  }
  const eligible = argumentEligibleGroups(candidates, snapshot, budget, omissions, scope)
  const paths = [...new Set(eligible.flatMap((group) => group.paths))]
  const headSizes =
    snapshot.head.kind === "initial"
      ? new Map<string, number>()
      : await loadHeadPathSizes(pi, root, snapshot.head.oid, paths, budget, signal)
  const initialCombined = scope === "combined" && snapshot.head.kind === "initial"
  const indexSizes =
    scope === "combined" && !initialCombined ? undefined : await loadIndexPathSizes(pi, root, paths, budget, signal)
  const checkFileStates = scope !== "staged" && !initialCombined
  const selectionScope = initialCombined ? "staged" : scope
  const before = checkFileStates
    ? await loadFileStates(root, paths, budget.concurrency, signal)
    : new Map<string, GitFileState>()
  const selected = selectTrackedGroups(
    eligible,
    snapshot,
    headSizes,
    before,
    indexSizes,
    selectionScope,
    budget,
    omissions,
    signal,
  )
  return { selected, paths, indexSizes, checkFileStates, before }
}

async function indexMatches(
  pi: ExtensionAPI,
  root: string,
  phase: TrackedSelectionPhase,
  budget: TrackedDiffBudget,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!phase.indexSizes) return true
  const identity = await loadIndexPathIdentity(pi, root, phase.paths, budget, signal)
  return identity === phase.indexSizes.identity
}

function recordChangedGroups(
  groups: readonly TrackedGroup[],
  snapshot: WorkingTreeSnapshot,
  omissions: Map<number, DiffFile>,
): void {
  for (const group of groups) {
    omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"))
  }
}

async function captureSelectedGroups(
  pi: ExtensionAPI,
  root: string,
  snapshot: WorkingTreeSnapshot,
  phase: TrackedSelectionPhase,
  budget: TrackedDiffBudget,
  omissions: Map<number, DiffFile>,
  scope: TrackedDiffCaptureScope,
  signal?: AbortSignal,
): Promise<TrackedPatchPhase | undefined> {
  const patchGroups = chunkLiteralPathGroups(
    phase.selected.map((group) => ({ value: group, paths: group.paths })),
    budget,
    workingTreeDiffArgs(snapshot, [], scope),
  )
  recordArgumentOmissions(patchGroups.oversized, snapshot, omissions)
  const capturable = patchGroups.batches.flat()
  if (capturable.length === 0) return
  if (!(await indexMatches(pi, root, phase, budget, signal))) {
    recordChangedGroups(capturable, snapshot, omissions)
    return
  }

  const capturedParts: string[] = []
  for (const batch of patchGroups.batches) {
    const batchPaths = [...new Set(batch.flatMap((group) => group.paths))]
    capturedParts.push((await runGit(pi, root, workingTreeDiffArgs(snapshot, batchPaths, scope), { signal })).stdout)
  }
  if (!(await indexMatches(pi, root, phase, budget, signal))) {
    recordChangedGroups(capturable, snapshot, omissions)
    return
  }
  const selectedPaths = [...new Set(capturable.flatMap((group) => group.paths))]
  const after = phase.checkFileStates
    ? await loadFileStates(root, selectedPaths, budget.concurrency, signal)
    : phase.before
  throwIfGitAborted(signal)
  return { raw: capturedParts.join(""), capturable, after }
}

function completeTrackedCapture(
  rawCapture: string,
  phase: TrackedSelectionPhase,
  patch: TrackedPatchPhase,
  groups: readonly TrackedGroup[],
  snapshot: WorkingTreeSnapshot,
  omissions: Map<number, DiffFile>,
  budget: TrackedDiffBudget,
): TrackedDiffCapture {
  const changed = phase.checkFileStates ? changedGroups(patch.capturable, phase.before, patch.after) : new Set<number>()
  const chunks = patchChunks(rawCapture, indexGroupsByPath(groups))
  const capturedGroups = new Set(chunks.flatMap((chunk) => chunk.groupIndexes))
  for (const group of patch.capturable) {
    if (changed.has(group.index)) {
      omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"))
    } else if (!capturedGroups.has(group.index)) {
      omissions.set(
        group.index,
        omittedTrackedGroup(group, snapshot, "unsupported-file", {
          detail: "Git produced no patch for this status entry; diff configuration may have suppressed it.",
        }),
      )
    }
  }
  const raw = retainTrackedPatchChunks(rawCapture, chunks, groups, snapshot, changed, omissions, budget)
  const omittedFiles = [...omissions.entries()].sort(([left], [right]) => left - right).map(([, file]) => file)
  return {
    raw,
    omittedFiles,
    capturedPatchBytes: utf8Bytes(raw),
    capturedPatchLines: textLineCount(raw),
  }
}

export async function captureTrackedDiff(
  pi: ExtensionAPI,
  root: string,
  snapshot: WorkingTreeSnapshot,
  budget: TrackedDiffBudget = DEFAULT_TRACKED_DIFF_BUDGET,
  signal?: AbortSignal,
  scope: TrackedDiffCaptureScope = "combined",
): Promise<TrackedDiffCapture> {
  throwIfGitAborted(signal)
  const scoped = scopedSnapshot(snapshot, scope)
  const groups = trackedGroups(scoped)
  if (groups.length === 0) {
    await runGit(pi, root, cleanSnapshotProbeArgs(scoped, scope), { signal, acceptedExitCodes: [0, 1] })
    return { raw: "", omittedFiles: [], capturedPatchBytes: 0, capturedPatchLines: 0 }
  }

  const omissions = new Map<number, DiffFile>()
  const selection = await prepareTrackedSelection(pi, root, scoped, groups, budget, omissions, scope, signal)
  if (selection.selected.length === 0) return emptyTrackedCapture(omissions)
  const patch = await captureSelectedGroups(pi, root, scoped, selection, budget, omissions, scope, signal)
  return patch
    ? completeTrackedCapture(patch.raw, selection, patch, groups, scoped, omissions, budget)
    : emptyTrackedCapture(omissions)
}
