import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  type CommitOmission,
  commitOmission,
  loadBoundedStagedEntries,
  type SizedEntry,
  type StagedEntry,
  StagedRawEntryDecoder,
} from "./commit-staged-snapshot.js"
import { DEFAULT_TRACKED_DIFF_BUDGET, type TrackedDiffBudget } from "./diff-budgets.js"
import { omittedDiffFile } from "./diff-omission.js"
import { parseDiff } from "./diff-parser-core.js"
import { readNulRecords, readPatchChunks, withGitOutputFile } from "./git-output-file.js"
import { textLineCount, utf8Bytes } from "./git-patch.js"
import { chunkLiteralPathGroups } from "./git-path-batches.js"
import { runGit, throwIfGitAborted } from "./git-service.js"
import type { DiffFile, DiffOmissionReason } from "./types.js"

export interface HistoricalDiffCapture {
  readonly commitOid: string
  readonly raw: string
  readonly omittedFiles: readonly DiffFile[]
  readonly omittedFileCount: number
  readonly capturedPatchBytes: number
  readonly capturedPatchLines: number
}

interface HistoricalBase {
  readonly commitOid: string
  readonly parentOid?: string
}

interface HistoricalPatchChunk {
  readonly raw: string
  readonly file: DiffFile
  readonly entryIndex?: number
  readonly bytes: number
  readonly lines: number
}

const DIFF_OPTIONS = [
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules=none",
  "--find-renames",
  "--find-copies",
  "--color=never",
] as const

function validateOid(value: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value)) throw new Error("Git returned an invalid commit OID")
  return value
}

async function resolveHistoricalBase(
  pi: ExtensionAPI,
  root: string,
  revision: string,
  signal?: AbortSignal,
): Promise<HistoricalBase> {
  const resolved = await runGit(pi, root, ["rev-parse", "--verify", `${revision}^{commit}`], { signal })
  const commitOid = validateOid(resolved.stdout.trim())
  const parents = await runGit(pi, root, ["rev-list", "--parents", "-n", "1", commitOid], { signal })
  const values = parents.stdout.trim().split(/\s+/u).filter(Boolean).map(validateOid)
  if (values[0] !== commitOid) throw new Error("Git returned parents for a different commit")
  return { commitOid, ...(values[1] === undefined ? {} : { parentOid: values[1] }) }
}

function rawDiffArgs(base: HistoricalBase, outputPath?: string): string[] {
  const prefix = ["-c", "core.quotepath=false"]
  const output = outputPath ? [`--output=${outputPath}`] : []
  const rawOptions = ["--raw", "-z", "--no-abbrev", "--no-textconv", "--find-renames", "--find-copies", ...output]
  return base.parentOid
    ? [...prefix, "diff", ...rawOptions, base.parentOid, base.commitOid, "--"]
    : [...prefix, "diff-tree", "--root", "--no-commit-id", "-r", ...rawOptions, base.commitOid, "--"]
}

function patchDiffArgs(base: HistoricalBase, paths: readonly string[], outputPath?: string): string[] {
  const prefix = ["--literal-pathspecs", "-c", "core.quotepath=false"]
  const output = outputPath ? [`--output=${outputPath}`] : []
  return base.parentOid
    ? [...prefix, "diff", ...DIFF_OPTIONS, ...output, base.parentOid, base.commitOid, "--", ...paths]
    : [
        ...prefix,
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-p",
        ...DIFF_OPTIONS,
        ...output,
        base.commitOid,
        "--",
        ...paths,
      ]
}

interface HistoricalEntries {
  readonly entries: readonly StagedEntry[]
  readonly skippedEntries: number
}

async function loadHistoricalEntries(
  pi: ExtensionAPI,
  root: string,
  base: HistoricalBase,
  maxEntries: number,
  signal?: AbortSignal,
): Promise<HistoricalEntries> {
  return withGitOutputFile(
    pi,
    root,
    (outputPath) => rawDiffArgs(base, outputPath),
    async (outputPath) => {
      const decoder = new StagedRawEntryDecoder()
      const entries: StagedEntry[] = []
      let skippedEntries = 0
      for await (const record of readNulRecords(outputPath, signal)) {
        const entry = decoder.push(record)
        if (!entry) continue
        if (entries.length < Math.max(0, maxEntries)) entries.push(entry)
        else skippedEntries++
      }
      decoder.finish()
      return { entries, skippedEntries }
    },
    { signal },
  )
}

function entryStatus(entry: StagedEntry): DiffFile["status"] {
  if (entry.status.startsWith("A")) return "added"
  if (entry.status.startsWith("D")) return "deleted"
  if (entry.status.startsWith("R")) return "renamed"
  if (entry.status.startsWith("C")) return "copied"
  return "modified"
}

function omittedHistoricalFile(entry: StagedEntry, omission: CommitOmission["omission"]): DiffFile {
  return {
    path: entry.path,
    ...(entry.originalPath === undefined ? {} : { oldPath: entry.originalPath }),
    ...(entry.status.startsWith("R") || entry.status.startsWith("C") ? { newPath: entry.path } : {}),
    status: entryStatus(entry),
    staged: false,
    lines: [],
    omission,
  }
}

function entryIndexByPath(entries: readonly StagedEntry[]): Map<string, number> {
  return new Map(entries.flatMap((entry) => entry.paths.map((path) => [path, entry.index] as const)))
}

function historicalPatchChunk(raw: string, indexes: ReadonlyMap<string, number>): HistoricalPatchChunk {
  const file = parseDiff(raw)[0] ?? { path: "(unknown)", status: "modified", staged: false, lines: [] }
  return {
    raw,
    file,
    entryIndex: indexes.get(file.path) ?? (file.oldPath ? indexes.get(file.oldPath) : undefined),
    bytes: utf8Bytes(raw),
    lines: textLineCount(raw),
  }
}

function recordCaptureOmission(
  omissions: Map<number, CommitOmission>,
  entries: readonly StagedEntry[],
  chunk: HistoricalPatchChunk,
  index: number,
  reason: DiffOmissionReason,
  details: Parameters<typeof commitOmission>[3],
): void {
  const entryIndex = chunk.entryIndex ?? entries.length + index
  const path = entries[entryIndex]?.path ?? chunk.file.path
  omissions.set(entryIndex, commitOmission(entryIndex, path, reason, details))
}

interface HistoricalRetention {
  readonly parts: string[]
  readonly captured: Set<number>
  bytes: number
  lines: number
  sequence: number
  stopped?: "bytes" | "lines"
}

function retentionOmission(
  state: HistoricalRetention,
  chunk: HistoricalPatchChunk,
  budget: TrackedDiffBudget,
): { reason: DiffOmissionReason; details: Parameters<typeof commitOmission>[3] } | undefined {
  if (state.stopped === "bytes" || state.bytes + chunk.bytes > budget.maxPatchBytes) {
    state.stopped = "bytes"
    return {
      reason: "capture-overflow",
      details: { measuredBytes: state.bytes + chunk.bytes, limitBytes: budget.maxPatchBytes },
    }
  }
  if (state.stopped === "lines" || state.lines + chunk.lines > budget.maxPatchLines) {
    state.stopped = "lines"
    return {
      reason: "aggregate-line-budget",
      details: { measuredLines: state.lines + chunk.lines, limitLines: budget.maxPatchLines },
    }
  }
}

function retainHistoricalChunk(
  state: HistoricalRetention,
  chunk: HistoricalPatchChunk,
  entries: readonly StagedEntry[],
  omissions: Map<number, CommitOmission>,
  budget: TrackedDiffBudget,
): void {
  const sequence = state.sequence++
  if (chunk.entryIndex !== undefined) state.captured.add(chunk.entryIndex)
  if (chunk.entryIndex !== undefined && omissions.has(chunk.entryIndex)) return
  const omitted = retentionOmission(state, chunk, budget)
  if (omitted) {
    recordCaptureOmission(omissions, entries, chunk, sequence, omitted.reason, omitted.details)
    return
  }
  state.parts.push(chunk.raw)
  state.bytes += chunk.bytes
  state.lines += chunk.lines
}

function completeSelectedEntries(
  selected: readonly SizedEntry[],
  captured: ReadonlySet<number>,
  omissions: Map<number, CommitOmission>,
): void {
  for (const entry of selected) {
    if (captured.has(entry.index) || omissions.has(entry.index)) continue
    omissions.set(
      entry.index,
      commitOmission(entry.index, entry.path, "unsupported-file", {
        detail: "Git produced no patch for this historical entry.",
      }),
    )
  }
}

function unenumeratedHistoricalFiles(count: number, limitFiles: number): DiffFile | undefined {
  if (count === 0) return
  return omittedDiffFile({
    path: `(${count} additional changed file${count === 1 ? "" : "s"})`,
    status: "modified",
    staged: false,
    reason: "file-count-budget",
    limitFiles,
    detail: `${count} additional changed file(s) were counted but not retained as individual viewer entries.`,
  })
}

export async function captureHistoricalDiff(
  pi: ExtensionAPI,
  root: string,
  revision: string,
  budget: TrackedDiffBudget = DEFAULT_TRACKED_DIFF_BUDGET,
  signal?: AbortSignal,
): Promise<HistoricalDiffCapture> {
  throwIfGitAborted(signal)
  const base = await resolveHistoricalBase(pi, root, revision, signal)
  const metadata = await loadHistoricalEntries(pi, root, base, budget.maxFiles, signal)
  const entries = metadata.entries
  const omissions = new Map<number, CommitOmission>()
  const selected = await loadBoundedStagedEntries(pi, root, entries, budget, omissions, signal)
  const pathGroups = chunkLiteralPathGroups(
    selected.map((entry) => ({ value: entry, paths: entry.paths })),
    budget,
    patchDiffArgs(base, []),
  )
  for (const entry of pathGroups.oversized) {
    omissions.set(
      entry.index,
      commitOmission(entry.index, entry.path, "capture-overflow", {
        detail: "The path group exceeds the configured Git argument limit.",
      }),
    )
  }

  const retention: HistoricalRetention = {
    parts: [],
    captured: new Set(),
    bytes: 0,
    lines: 0,
    sequence: 0,
  }
  const indexes = entryIndexByPath(entries)
  for (const batch of pathGroups.batches) {
    const paths = [...new Set(batch.flatMap((entry) => entry.paths))]
    await withGitOutputFile(
      pi,
      root,
      (outputPath) => patchDiffArgs(base, paths, outputPath),
      async (outputPath) => {
        for await (const rawChunk of readPatchChunks(outputPath, signal)) {
          retainHistoricalChunk(retention, historicalPatchChunk(rawChunk, indexes), entries, omissions, budget)
        }
      },
      { signal },
    )
  }
  completeSelectedEntries(pathGroups.batches.flat(), retention.captured, omissions)
  const raw = retention.parts.join("")
  const omittedFiles = [...omissions.values()]
    .sort((left, right) => left.index - right.index)
    .map((item) => {
      const entry = entries[item.index]
      return entry
        ? omittedHistoricalFile(entry, item.omission)
        : omittedDiffFile({
            path: item.path,
            status: "modified",
            staged: false,
            reason: item.omission.reason,
            detail: item.omission.message,
          })
    })
  const aggregateOmission = unenumeratedHistoricalFiles(metadata.skippedEntries, budget.maxFiles)
  if (aggregateOmission) omittedFiles.push(aggregateOmission)
  return {
    commitOid: base.commitOid,
    raw,
    omittedFiles,
    omittedFileCount: omissions.size + metadata.skippedEntries,
    capturedPatchBytes: utf8Bytes(raw),
    capturedPatchLines: textLineCount(raw),
  }
}
