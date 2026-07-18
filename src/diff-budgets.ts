const KIB = 1024
const MIB = 1024 * KIB
const SAFE_ARGV_BYTES = 24 * KIB

export interface LiteralPathBudget {
  readonly argvChunkBytes: number
  readonly argvChunkPaths: number
}

export interface UntrackedDiffBudget extends LiteralPathBudget {
  readonly concurrency: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxPatchBytes: number
  readonly maxPatchLines: number
}

export interface TrackedDiffBudget extends LiteralPathBudget {
  readonly concurrency: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxPatchBytes: number
  readonly maxPatchLines: number
}

export interface CommitPromptBudget extends LiteralPathBudget {
  readonly concurrency: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxPatchChars: number
  readonly maxPatchLines: number
  readonly maxStatChars: number
  readonly maxInputChars: number
  readonly maxPromptChars: number
}

export const DEFAULT_UNTRACKED_DIFF_BUDGET: Readonly<UntrackedDiffBudget> = Object.freeze({
  concurrency: 4,
  argvChunkBytes: SAFE_ARGV_BYTES,
  argvChunkPaths: 256,
  maxFiles: 100,
  maxFileBytes: 256 * KIB,
  maxTotalBytes: 2 * MIB,
  maxPatchBytes: 2 * MIB,
  maxPatchLines: 50_000,
})

export const DEFAULT_TRACKED_DIFF_BUDGET: Readonly<TrackedDiffBudget> = Object.freeze({
  concurrency: 4,
  argvChunkBytes: SAFE_ARGV_BYTES,
  argvChunkPaths: 256,
  maxFiles: 500,
  maxFileBytes: 2 * MIB,
  maxTotalBytes: 8 * MIB,
  maxPatchBytes: 8 * MIB,
  maxPatchLines: 100_000,
})

export const DEFAULT_COMMIT_PROMPT_BUDGET: Readonly<CommitPromptBudget> = Object.freeze({
  concurrency: 4,
  argvChunkBytes: SAFE_ARGV_BYTES,
  argvChunkPaths: 256,
  maxFiles: 50,
  maxFileBytes: 128 * KIB,
  maxTotalBytes: 512 * KIB,
  maxPatchChars: 20_000,
  maxPatchLines: 2_000,
  maxStatChars: 2_000,
  maxInputChars: 23_000,
  maxPromptChars: 24_000,
})

export const SUBMODULE_SOURCE_BYTES = 1024
