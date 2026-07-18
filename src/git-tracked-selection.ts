import type { TrackedDiffBudget } from "./diff-budgets.js"
import { SUBMODULE_SOURCE_BYTES } from "./diff-budgets.js"
import { omittedDiffFile } from "./diff-omission.js"
import type { GitFileState } from "./git-file-state.js"
import type { IndexPathSizes } from "./git-object-sizes.js"
import { throwIfGitAborted } from "./git-service.js"
import type { StatusEntry, WorkingTreeSnapshot } from "./git-status.js"
import type { DiffFile, DiffOmissionReason } from "./types.js"

export interface TrackedGroup {
  readonly index: number
  readonly entry: StatusEntry
  readonly paths: readonly string[]
}

export interface SelectedGroup extends TrackedGroup {
  readonly sourceBytes: number
}

interface SourceMeasurement {
  readonly totalBytes: number
  readonly maxFileBytes: number
  readonly unsupported?: string
  readonly changed?: boolean
}

function uniquePaths(entry: StatusEntry): string[] {
  return [...new Set([entry.originalPath, entry.path].filter((path): path is string => path !== undefined))]
}

export function trackedGroups(snapshot: WorkingTreeSnapshot): TrackedGroup[] {
  return snapshot.entries.map((entry, index) => ({ index, entry, paths: uniquePaths(entry) }))
}

function statusForEntry(entry: StatusEntry): DiffFile["status"] {
  if (entry.kind === "unmerged") return "conflicted"
  if (entry.similarity?.kind === "rename") return "renamed"
  if (entry.similarity?.kind === "copy") return "copied"
  const statuses = `${entry.indexStatus}${entry.worktreeStatus}`
  if (statuses.includes("A")) return "added"
  if (statuses.includes("D")) return "deleted"
  if (statuses.includes("R")) return "renamed"
  if (statuses.includes("C")) return "copied"
  return "modified"
}

export function omittedTrackedGroup(
  group: TrackedGroup,
  snapshot: WorkingTreeSnapshot,
  reason: DiffOmissionReason,
  details: Omit<Parameters<typeof omittedDiffFile>[0], "path" | "reason" | "status" | "staged"> = {},
): DiffFile {
  return omittedDiffFile({
    path: group.entry.path,
    reason,
    status: statusForEntry(group.entry),
    staged: snapshot.stagedPaths.has(group.entry.path),
    ...(group.entry.originalPath === undefined ? {} : { oldPath: group.entry.originalPath }),
    ...(group.entry.kind === "rename" ? { newPath: group.entry.path } : {}),
    ...(group.entry.submodule.startsWith("S") ? { submodule: group.entry.submodule } : {}),
    ...details,
  })
}

function measurementFromSizes(sizes: readonly number[]): SourceMeasurement {
  return {
    totalBytes: sizes.reduce((total, bytes) => total + bytes, 0),
    maxFileBytes: Math.max(0, ...sizes),
  }
}

function indexSourceBytes(group: TrackedGroup, indexSizes: IndexPathSizes): SourceMeasurement {
  if (indexSizes.changedPaths.has(group.entry.path) || !indexSizes.sizes.has(group.entry.path)) {
    return { totalBytes: 0, maxFileBytes: 0, changed: true }
  }
  return measurementFromSizes(group.paths.map((path) => indexSizes.sizes.get(path) ?? 0))
}

function worktreeSourceBytes(
  group: TrackedGroup,
  headSizes: ReadonlyMap<string, number>,
  states: ReadonlyMap<string, GitFileState>,
): SourceMeasurement {
  const sizes: number[] = []
  let unsupported: string | undefined
  for (const path of group.paths) {
    const headBytes = headSizes.get(path)
    const state = states.get(path)
    if (state?.kind === "unsupported" && headBytes === undefined) {
      unsupported ??= state.description
      continue
    }
    sizes.push(Math.max(headBytes ?? 0, state?.kind === "file" ? state.bytes : 0))
  }
  return { ...measurementFromSizes(sizes), ...(unsupported === undefined ? {} : { unsupported }) }
}

function sourceBytes(
  group: TrackedGroup,
  headSizes: ReadonlyMap<string, number>,
  states: ReadonlyMap<string, GitFileState>,
  indexSizes?: IndexPathSizes,
): SourceMeasurement {
  if (indexSizes) return indexSourceBytes(group, indexSizes)
  if (group.entry.submodule.startsWith("S")) {
    return { totalBytes: SUBMODULE_SOURCE_BYTES, maxFileBytes: SUBMODULE_SOURCE_BYTES }
  }
  return worktreeSourceBytes(group, headSizes, states)
}

function recordStoppedOmission(
  group: TrackedGroup,
  snapshot: WorkingTreeSnapshot,
  stopped: "count" | "bytes",
  budget: TrackedDiffBudget,
  omissions: Map<number, DiffFile>,
): void {
  const reason = stopped === "count" ? "file-count-budget" : "aggregate-byte-budget"
  omissions.set(
    group.index,
    omittedTrackedGroup(group, snapshot, reason, {
      ...(stopped === "count" ? { limitFiles: budget.maxFiles } : { limitBytes: budget.maxTotalBytes }),
    }),
  )
}

export function selectTrackedGroups(
  groups: readonly TrackedGroup[],
  snapshot: WorkingTreeSnapshot,
  headSizes: ReadonlyMap<string, number>,
  states: ReadonlyMap<string, GitFileState>,
  indexSizes: IndexPathSizes | undefined,
  budget: TrackedDiffBudget,
  omissions: Map<number, DiffFile>,
  signal?: AbortSignal,
): SelectedGroup[] {
  const selected: SelectedGroup[] = []
  let selectedBytes = 0
  let stopped: "count" | "bytes" | undefined
  for (const group of groups) {
    throwIfGitAborted(signal)
    const source = sourceBytes(group, headSizes, states, indexSizes)
    if (source.changed) {
      omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"))
    } else if (source.unsupported) {
      omissions.set(
        group.index,
        omittedTrackedGroup(group, snapshot, "unsupported-file", { detail: source.unsupported }),
      )
    } else if (source.maxFileBytes > budget.maxFileBytes) {
      omissions.set(
        group.index,
        omittedTrackedGroup(group, snapshot, "file-too-large", {
          measuredBytes: source.maxFileBytes,
          limitBytes: budget.maxFileBytes,
        }),
      )
    } else if (stopped || selected.length >= budget.maxFiles) {
      stopped ??= "count"
      recordStoppedOmission(group, snapshot, stopped, budget, omissions)
    } else if (selectedBytes + source.totalBytes > budget.maxTotalBytes) {
      stopped = "bytes"
      omissions.set(
        group.index,
        omittedTrackedGroup(group, snapshot, "aggregate-byte-budget", {
          measuredBytes: selectedBytes + source.totalBytes,
          limitBytes: budget.maxTotalBytes,
        }),
      )
    } else {
      selectedBytes += source.totalBytes
      selected.push({ ...group, sourceBytes: source.totalBytes })
    }
  }
  return selected
}
