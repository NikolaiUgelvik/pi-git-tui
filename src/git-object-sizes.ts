import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type LiteralPathBudget, SUBMODULE_SOURCE_BYTES } from "./diff-budgets.js"
import { chunkLiteralPaths, nulRecords, pathAfterTab } from "./git-path-batches.js"
import { runGit, throwIfGitAborted } from "./git-service.js"
import { mapGitWorkers } from "./git-worker-pool.js"

export interface ObjectSizeBudget extends LiteralPathBudget {
  readonly concurrency: number
}

export interface IndexPathSizes {
  readonly sizes: ReadonlyMap<string, number>
  readonly changedPaths: ReadonlySet<string>
  readonly identity: string
}

const HEAD_SIZE_ARGS = ["--literal-pathspecs", "-c", "core.quotepath=false", "ls-tree", "-l", "-r", "-z"] as const

const INDEX_ENTRY_ARGS = [
  "--literal-pathspecs",
  "-c",
  "core.quotepath=false",
  "ls-files",
  "--stage",
  "-z",
  "--",
] as const

function objectSize(raw: string): number {
  const bytes = Number(raw.trim())
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Git returned an invalid object size")
  return bytes
}

function parseHeadSizeRecord(record: string): { path: string; bytes: number } {
  const path = pathAfterTab(record)
  if (path === undefined) throw new Error("Malformed git ls-tree size output")
  const metadata = record.slice(0, record.indexOf("\t"))
  const match = /^([0-7]{6}) (?:blob|tree|commit) [0-9a-f]+\s+(-|\d+)$/iu.exec(metadata)
  if (!match) throw new Error("Malformed git ls-tree size metadata")
  return { path, bytes: match[2] === "-" ? SUBMODULE_SOURCE_BYTES : Number(match[2]) }
}

export async function loadHeadPathSizes(
  pi: ExtensionAPI,
  root: string,
  revision: string,
  paths: readonly string[],
  budget: LiteralPathBudget,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const fixedArgs = [...HEAD_SIZE_ARGS, revision, "--"]
  const sizes = new Map<string, number>()
  for (const batch of chunkLiteralPaths(paths, budget, fixedArgs)) {
    throwIfGitAborted(signal)
    const result = await runGit(pi, root, [...fixedArgs, ...batch], { signal })
    for (const record of nulRecords(result.stdout)) {
      const parsed = parseHeadSizeRecord(record)
      sizes.set(parsed.path, parsed.bytes)
    }
  }
  return sizes
}

interface IndexEntry {
  readonly path: string
  readonly mode: string
  readonly oid: string
}

function parseIndexEntry(record: string): IndexEntry {
  const path = pathAfterTab(record)
  if (path === undefined) throw new Error("Malformed git ls-files --stage output")
  const metadata = record.slice(0, record.indexOf("\t"))
  const match = /^([0-7]{6}) ([0-9a-f]+) ([0-3])$/iu.exec(metadata)
  if (!match) throw new Error("Malformed git ls-files --stage metadata")
  return { path, mode: match[1] ?? "000000", oid: match[2] ?? "" }
}

async function loadIndexEntries(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  budget: LiteralPathBudget,
  signal?: AbortSignal,
): Promise<{ entries: IndexEntry[]; identity: string }> {
  const entries: IndexEntry[] = []
  const identityParts: string[] = []
  for (const batch of chunkLiteralPaths(paths, budget, INDEX_ENTRY_ARGS)) {
    throwIfGitAborted(signal)
    const result = await runGit(pi, root, [...INDEX_ENTRY_ARGS, ...batch], { signal })
    identityParts.push(result.stdout)
    entries.push(...nulRecords(result.stdout).map(parseIndexEntry))
  }
  return { entries, identity: identityParts.join("") }
}

export async function loadIndexPathIdentity(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  budget: LiteralPathBudget,
  signal?: AbortSignal,
): Promise<string> {
  return (await loadIndexEntries(pi, root, paths, budget, signal)).identity
}

export async function loadIndexPathSizes(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  budget: ObjectSizeBudget,
  signal?: AbortSignal,
): Promise<IndexPathSizes> {
  const snapshot = await loadIndexEntries(pi, root, paths, budget, signal)
  const entries = snapshot.entries
  const objectIds = [
    ...new Set(
      entries.filter((entry) => entry.mode !== "160000" && !/^0+$/u.test(entry.oid)).map((entry) => entry.oid),
    ),
  ]
  const measured = await mapGitWorkers(
    objectIds,
    budget.concurrency,
    async (oid, _index, workerSignal) => {
      const result = await runGit(pi, root, ["cat-file", "-s", oid], { signal: workerSignal })
      return objectSize(result.stdout)
    },
    signal,
  )
  const objectSizes = new Map(objectIds.map((oid, index) => [oid, measured[index]]))
  const sizes = new Map<string, number>()
  const changedPaths = new Set<string>()
  for (const entry of entries) {
    const bytes = entry.mode === "160000" ? SUBMODULE_SOURCE_BYTES : objectSizes.get(entry.oid)
    if (bytes === undefined) {
      changedPaths.add(entry.path)
    } else {
      sizes.set(entry.path, Math.max(sizes.get(entry.path) ?? 0, bytes))
    }
  }
  return { sizes, changedPaths, identity: snapshot.identity }
}
