import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { SUBMODULE_SOURCE_BYTES } from "./diff-budgets.js"
import { createDiffOmission } from "./diff-omission.js"
import { runGit, throwIfGitAborted } from "./git-service.js"
import { mapGitWorkers } from "./git-worker-pool.js"
import type { DiffOmission, DiffOmissionReason } from "./types.js"

export interface StagedSelectionBudget {
  readonly concurrency: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}

export interface StagedEntry {
  readonly index: number
  readonly status: string
  readonly oldMode: string
  readonly newMode: string
  readonly oldOid: string
  readonly newOid: string
  readonly path: string
  readonly originalPath?: string
  readonly paths: readonly string[]
}

export interface SizedEntry extends StagedEntry {
  readonly sourceBytes: number
}

export interface CommitOmission {
  readonly index: number
  readonly path: string
  readonly omission: DiffOmission
}

const RAW_STAGED_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--cached",
  "--raw",
  "-z",
  "--no-abbrev",
  "--no-textconv",
  "--find-renames",
  "--find-copies",
  "--",
] as const

type StagedEntryMetadata = Omit<StagedEntry, "index" | "path" | "originalPath" | "paths">

function parseRawMetadata(record: string): StagedEntryMetadata {
  const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/iu.exec(record)
  if (!match) throw new Error("Malformed git diff --cached --raw metadata")
  return {
    oldMode: match[1] ?? "000000",
    newMode: match[2] ?? "000000",
    oldOid: match[3] ?? "",
    newOid: match[4] ?? "",
    status: match[5] ?? "",
  }
}

function isRenameOrCopy(metadata: StagedEntryMetadata): boolean {
  return metadata.status.startsWith("R") || metadata.status.startsWith("C")
}

function stagedEntry(
  index: number,
  metadata: StagedEntryMetadata,
  firstPath: string,
  secondPath?: string,
): StagedEntry {
  const originalPath = isRenameOrCopy(metadata) ? firstPath : undefined
  const path = secondPath ?? firstPath
  return {
    index,
    ...metadata,
    path,
    ...(originalPath === undefined ? {} : { originalPath }),
    paths: [...new Set([originalPath, path].filter((value): value is string => value !== undefined))],
  }
}

export class StagedRawEntryDecoder {
  private metadata: StagedEntryMetadata | undefined
  private firstPath: string | undefined
  private nextIndex = 0

  push(record: string): StagedEntry | undefined {
    if (!this.metadata) {
      this.metadata = parseRawMetadata(record)
      return
    }
    if (isRenameOrCopy(this.metadata) && this.firstPath === undefined) {
      this.firstPath = record
      return
    }
    const entry = stagedEntry(
      this.nextIndex++,
      this.metadata,
      this.firstPath ?? record,
      this.firstPath ? record : undefined,
    )
    this.metadata = undefined
    this.firstPath = undefined
    return entry
  }

  finish(): void {
    if (this.metadata || this.firstPath !== undefined) {
      throw new Error("Malformed git diff --cached --raw path records")
    }
  }
}

export function parseStagedRawDiff(raw: string): StagedEntry[] {
  if (!raw) return []
  const records = raw.split("\0")
  if (records.at(-1) === "") records.pop()
  const decoder = new StagedRawEntryDecoder()
  const entries = records.flatMap((record) => {
    const entry = decoder.push(record)
    return entry ? [entry] : []
  })
  decoder.finish()
  return entries
}

export async function loadStagedEntries(
  pi: ExtensionAPI,
  root: string,
  signal?: AbortSignal,
): Promise<{ raw: string; entries: StagedEntry[] }> {
  const result = await runGit(pi, root, RAW_STAGED_ARGS, { signal })
  return { raw: result.stdout, entries: parseStagedRawDiff(result.stdout) }
}

function objectIdsToMeasure(entries: readonly StagedEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        [
          { mode: entry.oldMode, oid: entry.oldOid },
          { mode: entry.newMode, oid: entry.newOid },
        ]
          .filter(({ mode, oid }) => mode !== "000000" && mode !== "160000" && !/^0+$/u.test(oid))
          .map(({ oid }) => oid),
      ),
    ),
  ]
}

async function loadObjectSizes(
  pi: ExtensionAPI,
  root: string,
  entries: readonly StagedEntry[],
  budget: StagedSelectionBudget,
  signal?: AbortSignal,
): Promise<Map<string, number | undefined>> {
  const objectIds = objectIdsToMeasure(entries)
  const sizes = await mapGitWorkers(
    objectIds,
    budget.concurrency,
    async (oid, _index, workerSignal) => {
      const result = await runGit(pi, root, ["cat-file", "-s", oid], { signal: workerSignal })
      const bytes = Number(result.stdout.trim())
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Git returned an invalid object size")
      return bytes
    },
    signal,
  )
  return new Map(objectIds.map((oid, index) => [oid, sizes[index]]))
}

export function commitOmission(
  index: number,
  path: string,
  reason: DiffOmissionReason,
  details: Parameters<typeof createDiffOmission>[1] = {},
): CommitOmission {
  return { index, path, omission: createDiffOmission(reason, details) }
}

function objectSize(mode: string, oid: string, sizes: ReadonlyMap<string, number | undefined>): number | undefined {
  if (mode === "000000" || /^0+$/u.test(oid)) return 0
  if (mode === "160000") return SUBMODULE_SOURCE_BYTES
  return sizes.get(oid)
}

function entrySize(
  entry: StagedEntry,
  sizes: ReadonlyMap<string, number | undefined>,
): { maxFileBytes: number; totalBytes: number } | undefined {
  const oldBytes = objectSize(entry.oldMode, entry.oldOid, sizes)
  const newBytes = objectSize(entry.newMode, entry.newOid, sizes)
  if (oldBytes === undefined || newBytes === undefined) return
  const maxFileBytes = Math.max(oldBytes, newBytes)
  return {
    maxFileBytes,
    totalBytes: entry.oldOid === entry.newOid ? maxFileBytes : oldBytes + newBytes,
  }
}

function selectStagedEntries(
  entries: readonly StagedEntry[],
  sizes: ReadonlyMap<string, number | undefined>,
  budget: StagedSelectionBudget,
  omissions: Map<number, CommitOmission>,
  signal?: AbortSignal,
): SizedEntry[] {
  const selected: SizedEntry[] = []
  let selectedBytes = 0
  let byteBudgetReached = false
  for (const entry of entries) {
    throwIfGitAborted(signal)
    const measurement = entrySize(entry, sizes)
    if (!measurement) {
      omissions.set(entry.index, commitOmission(entry.index, entry.path, "changed-during-load"))
    } else if (measurement.maxFileBytes > budget.maxFileBytes) {
      omissions.set(
        entry.index,
        commitOmission(entry.index, entry.path, "file-too-large", {
          measuredBytes: measurement.maxFileBytes,
          limitBytes: budget.maxFileBytes,
        }),
      )
    } else if (byteBudgetReached || selectedBytes + measurement.totalBytes > budget.maxTotalBytes) {
      byteBudgetReached = true
      omissions.set(
        entry.index,
        commitOmission(entry.index, entry.path, "aggregate-byte-budget", {
          ...(selectedBytes + measurement.totalBytes > budget.maxTotalBytes
            ? { measuredBytes: selectedBytes + measurement.totalBytes }
            : {}),
          limitBytes: budget.maxTotalBytes,
        }),
      )
    } else {
      selectedBytes += measurement.totalBytes
      selected.push({ ...entry, sourceBytes: measurement.totalBytes })
    }
  }
  return selected
}

export async function loadBoundedStagedEntries(
  pi: ExtensionAPI,
  root: string,
  entries: readonly StagedEntry[],
  budget: StagedSelectionBudget,
  omissions: Map<number, CommitOmission>,
  signal?: AbortSignal,
): Promise<SizedEntry[]> {
  const candidates = entries.slice(0, Math.max(0, budget.maxFiles))
  for (const entry of entries.slice(candidates.length)) {
    omissions.set(
      entry.index,
      commitOmission(entry.index, entry.path, "file-count-budget", { limitFiles: budget.maxFiles }),
    )
  }
  const sizes = await loadObjectSizes(pi, root, candidates, budget, signal)
  return selectStagedEntries(candidates, sizes, budget, omissions, signal)
}
