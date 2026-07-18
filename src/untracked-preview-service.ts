import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitExitCode, assertGitSuccess, git, isUnbornHeadResult } from "./git-service.js"
import {
  type HeadState,
  MAX_UNTRACKED_FILE_BYTES,
  MAX_UNTRACKED_PREVIEW_BYTES,
  MAX_UNTRACKED_PREVIEW_CONCURRENCY,
  MAX_UNTRACKED_PREVIEW_FILES,
} from "./types.js"

export interface UntrackedDiffPreview {
  path: string
  raw: string
  include: boolean
}

export interface UntrackedPreviewLimits {
  concurrency: number
  maxFileBytes: number
  maxPreviewBytes: number
  maxPreviewFiles: number
}

interface PreviewCandidate {
  path: string
  include: boolean
  size?: number
}

const DEFAULT_LIMITS: UntrackedPreviewLimits = {
  concurrency: MAX_UNTRACKED_PREVIEW_CONCURRENCY,
  maxFileBytes: MAX_UNTRACKED_FILE_BYTES,
  maxPreviewBytes: MAX_UNTRACKED_PREVIEW_BYTES,
  maxPreviewFiles: MAX_UNTRACKED_PREVIEW_FILES,
}

function positiveWhole(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

function nonNegativeWhole(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function normalizedLimits(overrides: Partial<UntrackedPreviewLimits>): UntrackedPreviewLimits {
  return {
    concurrency: positiveWhole(overrides.concurrency ?? DEFAULT_LIMITS.concurrency, DEFAULT_LIMITS.concurrency),
    maxFileBytes: nonNegativeWhole(overrides.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
    maxPreviewBytes: nonNegativeWhole(
      overrides.maxPreviewBytes ?? DEFAULT_LIMITS.maxPreviewBytes,
      DEFAULT_LIMITS.maxPreviewBytes,
    ),
    maxPreviewFiles: nonNegativeWhole(
      overrides.maxPreviewFiles ?? DEFAULT_LIMITS.maxPreviewFiles,
      DEFAULT_LIMITS.maxPreviewFiles,
    ),
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      try {
        signal?.throwIfAborted()
        const index = nextIndex
        nextIndex += 1
        const item = items[index]
        if (item !== undefined) {
          results[index] = await operation(item, index)
        }
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
  }
  const workerCount = Math.min(items.length, positiveWhole(concurrency, 1))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (failed) {
    throw failure
  }
  return results
}

function indexEntryPaths(output: string): Set<string> {
  const paths = output.split("\0").flatMap((entry) => {
    const separator = entry.indexOf("\t")
    return separator < 0 ? [] : [entry.slice(separator + 1)]
  })
  return new Set(paths)
}

async function currentIndexPaths(
  pi: ExtensionAPI,
  cwd: string,
  files: string[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  const args = ["-c", "core.quotepath=false", "ls-files", "--stage", "-z", "--", ...files]
  const result = await git(pi, cwd, args, signal)
  assertGitSuccess(result, args, cwd)
  return indexEntryPaths(result.stdout)
}

async function currentHeadPaths(
  pi: ExtensionAPI,
  cwd: string,
  files: string[],
  headState: HeadState,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const args = ["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...files]
  const result = await git(pi, cwd, args, signal)
  if (!result.killed && result.code === 128 && headState === "unborn" && isUnbornHeadResult(result)) {
    return new Set()
  }
  assertGitSuccess(result, args, cwd)
  return new Set(result.stdout.split("\0").filter(Boolean))
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}

async function inspectCandidate(
  cwd: string,
  file: string,
  trackedInIndex: Set<string>,
  trackedInHead: Set<string>,
  maxFileBytes: number,
  signal?: AbortSignal,
): Promise<PreviewCandidate> {
  signal?.throwIfAborted()
  if (trackedInIndex.has(file) || trackedInHead.has(file)) {
    return { path: file, include: false }
  }

  let nodeStat: Awaited<ReturnType<typeof lstat>>
  try {
    nodeStat = await lstat(resolve(cwd, file))
  } catch (error) {
    if (isMissingPathError(error)) {
      return { path: file, include: false }
    }
    throw error
  }
  const previewable = nodeStat.isFile() || nodeStat.isSymbolicLink()
  if (!previewable || nodeStat.size > maxFileBytes) {
    return { path: file, include: true }
  }
  return { path: file, include: true, size: nodeStat.size }
}

function admittedCandidateIndexes(candidates: PreviewCandidate[], limits: UntrackedPreviewLimits): number[] {
  const indexes: number[] = []
  let admittedBytes = 0
  for (let index = 0; index < candidates.length; index += 1) {
    const size = candidates[index]?.size
    if (
      size === undefined ||
      indexes.length >= limits.maxPreviewFiles ||
      admittedBytes + size > limits.maxPreviewBytes
    ) {
      continue
    }
    indexes.push(index)
    admittedBytes += size
  }
  return indexes
}

async function readPatch(pi: ExtensionAPI, cwd: string, file: string, signal?: AbortSignal): Promise<string> {
  const args = ["-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", file]
  const result = await git(pi, cwd, args, signal)
  assertGitExitCode(result, args, [0, 1], cwd)
  return result.stdout
}

export async function readUntrackedDiffPreviews(
  pi: ExtensionAPI,
  cwd: string,
  files: string[],
  headState: HeadState,
  signal?: AbortSignal,
  limitOverrides: Partial<UntrackedPreviewLimits> = {},
): Promise<UntrackedDiffPreview[]> {
  if (files.length === 0) {
    return []
  }
  const limits = normalizedLimits(limitOverrides)
  const trackedInIndex = await currentIndexPaths(pi, cwd, files, signal)
  signal?.throwIfAborted()
  const trackedInHead = await currentHeadPaths(pi, cwd, files, headState, signal)
  const candidates = await mapWithConcurrency(files, limits.concurrency, signal, (file) =>
    inspectCandidate(cwd, file, trackedInIndex, trackedInHead, limits.maxFileBytes, signal),
  )
  const admittedIndexes = admittedCandidateIndexes(candidates, limits)
  const patches = await mapWithConcurrency(admittedIndexes, limits.concurrency, signal, (index) =>
    readPatch(pi, cwd, candidates[index]?.path ?? "", signal),
  )
  const patchByIndex = new Map(admittedIndexes.map((index, position) => [index, patches[position] ?? ""]))
  let retainedPatchBytes = 0

  return candidates.map((candidate, index) => {
    const patch = patchByIndex.get(index) ?? ""
    const patchBytes = Buffer.byteLength(patch)
    const withinOutputBudget = retainedPatchBytes + patchBytes <= limits.maxPreviewBytes
    if (withinOutputBudget) {
      retainedPatchBytes += patchBytes
    }
    return { path: candidate.path, include: candidate.include, raw: withinOutputBudget ? patch : "" }
  })
}
