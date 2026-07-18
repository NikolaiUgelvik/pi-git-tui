import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DEFAULT_UNTRACKED_DIFF_BUDGET, type UntrackedDiffBudget } from "./diff-budgets.js"
import { createDiffOmission } from "./diff-omission.js"
import { type GitFileState, loadGitFileState, sameGitFileState } from "./git-file-state.js"
import { textLineCount, utf8Bytes } from "./git-patch.js"
import { chunkLiteralPathGroups, chunkLiteralPaths, nulRecords, pathAfterTab } from "./git-path-batches.js"
import { runGit, throwIfGitAborted } from "./git-service.js"
import type { WorkingTreeSnapshot } from "./git-status.js"
import { mapGitWorkers } from "./git-worker-pool.js"
import type { DiffOmission, DiffOmissionReason } from "./types.js"

export type UntrackedDiffResult =
  | { kind: "patch"; path: string; raw: string; bytes: number; lines: number }
  | {
      kind: "omitted"
      path: string
      reason: DiffOmissionReason
      bytes?: number
      omission: DiffOmission
    }

interface IndexedPath {
  readonly index: number
  readonly path: string
}

interface EligiblePath extends IndexedPath {
  readonly state: Extract<GitFileState, { kind: "file" }>
}

type ResultSlot = UntrackedDiffResult | undefined

const INDEX_ARGS = ["--literal-pathspecs", "-c", "core.quotepath=false", "ls-files", "--stage", "-z", "--"]
const UNTRACKED_DIFF_ARGS = [
  "--literal-pathspecs",
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-index",
  "--no-textconv",
  "--",
  process.platform === "win32" ? "NUL" : "/dev/null",
] as const

function untrackedDiffArgs(path: string): string[] {
  return [...UNTRACKED_DIFF_ARGS, path]
}
function omitted(
  path: string,
  reason: DiffOmissionReason,
  details: Parameters<typeof createDiffOmission>[1] = {},
): UntrackedDiffResult {
  return {
    kind: "omitted",
    path,
    reason,
    ...(details.measuredBytes === undefined ? {} : { bytes: details.measuredBytes }),
    omission: createDiffOmission(reason, details),
  }
}

async function loadIndexMembership(
  pi: ExtensionAPI,
  root: string,
  pathsToCheck: readonly string[],
  budget: UntrackedDiffBudget,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const index = new Set<string>()
  for (const paths of chunkLiteralPaths(pathsToCheck, budget, INDEX_ARGS)) {
    throwIfGitAborted(signal)
    const result = await runGit(pi, root, [...INDEX_ARGS, ...paths], { signal })
    for (const record of nulRecords(result.stdout)) {
      const path = pathAfterTab(record)
      if (path === undefined) {
        throw new Error("Malformed git ls-files --stage output")
      }
      index.add(path)
    }
  }
  return index
}

async function inspectCandidates(
  root: string,
  paths: readonly IndexedPath[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<GitFileState[]> {
  return mapGitWorkers(
    paths,
    concurrency,
    async ({ path }, _index, workerSignal) => {
      throwIfGitAborted(workerSignal)
      const state = await loadGitFileState(root, path)
      throwIfGitAborted(workerSignal)
      return state
    },
    signal,
  )
}

function selectCandidates(
  candidates: readonly IndexedPath[],
  states: readonly GitFileState[],
  slots: ResultSlot[],
  budget: UntrackedDiffBudget,
  signal?: AbortSignal,
): EligiblePath[] {
  const selected: EligiblePath[] = []
  let selectedBytes = 0
  let stopped: "count" | "bytes" | undefined

  for (const [index, candidate] of candidates.entries()) {
    throwIfGitAborted(signal)
    const state = states[index]
    if (!state || state.kind === "missing") {
      slots[candidate.index] = omitted(candidate.path, "changed-during-load")
      continue
    }
    if (state.kind === "unsupported") {
      slots[candidate.index] = omitted(candidate.path, "unsupported-file", { detail: state.description })
      continue
    }
    if (state.bytes > budget.maxFileBytes) {
      slots[candidate.index] = omitted(candidate.path, "file-too-large", {
        measuredBytes: state.bytes,
        limitBytes: budget.maxFileBytes,
      })
      continue
    }
    if (stopped === "count" || selected.length >= budget.maxFiles) {
      stopped = "count"
      slots[candidate.index] = omitted(candidate.path, "file-count-budget", { limitFiles: budget.maxFiles })
      continue
    }
    if (stopped === "bytes") {
      slots[candidate.index] = omitted(candidate.path, "aggregate-byte-budget", {
        limitBytes: budget.maxTotalBytes,
      })
      continue
    }
    if (selectedBytes + state.bytes > budget.maxTotalBytes) {
      stopped = "bytes"
      slots[candidate.index] = omitted(candidate.path, "aggregate-byte-budget", {
        measuredBytes: selectedBytes + state.bytes,
        limitBytes: budget.maxTotalBytes,
      })
      continue
    }
    selectedBytes += state.bytes
    selected.push({ ...candidate, state })
  }
  return selected
}

async function captureCandidate(
  pi: ExtensionAPI,
  root: string,
  candidate: EligiblePath,
  signal: AbortSignal,
): Promise<UntrackedDiffResult> {
  throwIfGitAborted(signal)
  const result = await runGit(pi, root, untrackedDiffArgs(candidate.path), {
    signal,
    acceptedExitCodes: [0, 1],
  })
  const after = await loadGitFileState(root, candidate.path)
  throwIfGitAborted(signal)
  if (!sameGitFileState(candidate.state, after)) {
    return omitted(candidate.path, "changed-during-load", { measuredBytes: candidate.state.bytes })
  }
  return {
    kind: "patch",
    path: candidate.path,
    raw: result.stdout,
    bytes: utf8Bytes(result.stdout),
    lines: textLineCount(result.stdout),
  }
}

function retainCaptured(
  captured: readonly UntrackedDiffResult[],
  selected: readonly EligiblePath[],
  slots: ResultSlot[],
  budget: UntrackedDiffBudget,
  signal?: AbortSignal,
): void {
  let retainedBytes = 0
  let retainedLines = 0
  let stopped: "bytes" | "lines" | undefined
  for (const [index, result] of captured.entries()) {
    throwIfGitAborted(signal)
    const candidate = selected[index]
    if (!candidate) continue
    if (result.kind === "omitted") {
      slots[candidate.index] = result
      continue
    }
    const separatorBytes = result.raw ? 1 : 0
    if (stopped === "bytes") {
      slots[candidate.index] = omitted(candidate.path, "capture-overflow", { limitBytes: budget.maxPatchBytes })
      continue
    }
    if (stopped === "lines") {
      slots[candidate.index] = omitted(candidate.path, "aggregate-line-budget", { limitLines: budget.maxPatchLines })
      continue
    }
    if (retainedBytes + result.bytes + separatorBytes > budget.maxPatchBytes) {
      stopped = "bytes"
      slots[candidate.index] = omitted(candidate.path, "capture-overflow", {
        measuredBytes: retainedBytes + result.bytes + separatorBytes,
        limitBytes: budget.maxPatchBytes,
      })
      continue
    }
    if (retainedLines + result.lines + (result.raw ? 1 : 0) > budget.maxPatchLines) {
      stopped = "lines"
      slots[candidate.index] = omitted(candidate.path, "aggregate-line-budget", {
        measuredLines: retainedLines + result.lines + (result.raw ? 1 : 0),
        limitLines: budget.maxPatchLines,
      })
      continue
    }
    retainedBytes += result.bytes + separatorBytes
    retainedLines += result.lines + (result.raw ? 1 : 0)
    slots[candidate.index] = result
  }
}

export async function loadUntrackedDiffs(
  pi: ExtensionAPI,
  root: string,
  snapshot: WorkingTreeSnapshot,
  budget: UntrackedDiffBudget = DEFAULT_UNTRACKED_DIFF_BUDGET,
  signal?: AbortSignal,
): Promise<UntrackedDiffResult[]> {
  throwIfGitAborted(signal)
  if (snapshot.untrackedPaths.length === 0) {
    return []
  }

  const slots: ResultSlot[] = new Array(snapshot.untrackedPaths.length)
  const indexedPaths = snapshot.untrackedPaths.map((path, index) => ({ index, path }))
  const pathGroups = chunkLiteralPathGroups(
    indexedPaths.map((value) => ({ value, paths: [value.path] })),
    budget,
    UNTRACKED_DIFF_ARGS,
  )
  for (const path of pathGroups.oversized) {
    slots[path.index] = omitted(path.path, "capture-overflow", {
      detail: "The path exceeds the configured Git argument limit.",
    })
  }
  const argumentSafePaths = pathGroups.batches.flat()
  const membership = await loadIndexMembership(
    pi,
    root,
    argumentSafePaths.map((candidate) => candidate.path),
    budget,
    signal,
  )
  const candidates: IndexedPath[] = []
  for (const candidate of argumentSafePaths) {
    if (membership.has(candidate.path)) slots[candidate.index] = omitted(candidate.path, "changed-during-load")
    else candidates.push(candidate)
  }

  const states = await inspectCandidates(root, candidates, budget.concurrency, signal)
  const selected = selectCandidates(candidates, states, slots, budget, signal)
  const captured = await mapGitWorkers(
    selected,
    budget.concurrency,
    (candidate, _index, workerSignal) => captureCandidate(pi, root, candidate, workerSignal),
    signal,
  )
  const postCaptureMembership = await loadIndexMembership(
    pi,
    root,
    selected.map((candidate) => candidate.path),
    budget,
    signal,
  )
  const revalidated = captured.map((result, index) => {
    const candidate = selected[index]
    if (!candidate) return result
    return postCaptureMembership.has(candidate.path)
      ? omitted(candidate.path, "changed-during-load", { measuredBytes: candidate.state.bytes })
      : result
  })
  retainCaptured(revalidated, selected, slots, budget, signal)
  throwIfGitAborted(signal)
  return slots.filter((result): result is UntrackedDiffResult => result !== undefined)
}
