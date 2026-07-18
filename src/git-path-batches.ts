import type { LiteralPathBudget } from "./diff-budgets.js"

function windowsQuotedLength(value: string): number {
  if (value.length > 0 && !/[\s"]/u.test(value)) return value.length
  let length = 2
  let backslashes = 0
  for (const character of value) {
    if (character === "\\") {
      backslashes++
      continue
    }
    if (character === '"') {
      length += backslashes * 2 + 2
    } else {
      length += backslashes + character.length
    }
    backslashes = 0
  }
  return length + backslashes * 2
}

function encodedArgumentBytes(value: string): number {
  const utf8Bytes = Buffer.byteLength(value, "utf8") + 1
  const conservativeWindowsBytes = (windowsQuotedLength(value) + 1) * 2
  return Math.max(utf8Bytes, conservativeWindowsBytes)
}

function argumentsBytes(values: readonly string[]): number {
  return values.reduce((total, value) => total + encodedArgumentBytes(value), 0)
}

export function literalPathsFit(
  paths: readonly string[],
  budget: LiteralPathBudget,
  fixedArgs: readonly string[] = [],
): boolean {
  return (
    paths.length <= budget.argvChunkPaths && argumentsBytes(fixedArgs) + argumentsBytes(paths) <= budget.argvChunkBytes
  )
}

export function chunkLiteralPaths(
  paths: readonly string[],
  budget: LiteralPathBudget,
  fixedArgs: readonly string[] = [],
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  for (const path of paths) {
    if (!literalPathsFit([path], budget, fixedArgs)) {
      throw new Error(`Git path exceeds the configured argument limit: ${JSON.stringify(path)}`)
    }
    if (current.length > 0 && !literalPathsFit([...current, path], budget, fixedArgs)) {
      chunks.push(current)
      current = []
    }
    current.push(path)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export interface LiteralPathGroup<T> {
  readonly value: T
  readonly paths: readonly string[]
}

export interface LiteralPathGroupChunks<T> {
  readonly batches: readonly (readonly T[])[]
  readonly oversized: readonly T[]
}

interface ConnectedGroup<T> {
  readonly values: readonly T[]
  readonly paths: readonly string[]
}

function connectedLiteralPathGroups<T>(groups: readonly LiteralPathGroup<T>[]): ConnectedGroup<T>[] {
  const parents = groups.map((_group, index) => index)
  const firstGroupByPath = new Map<string, number>()
  const find = (index: number): number => {
    let root = index
    while (parents[root] !== root) root = parents[root] ?? root
    while (parents[index] !== index) {
      const next = parents[index] ?? root
      parents[index] = root
      index = next
    }
    return root
  }
  const union = (left: number, right: number): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot)
  }

  groups.forEach((group, index) => {
    for (const path of new Set(group.paths)) {
      const previous = firstGroupByPath.get(path)
      if (previous === undefined) firstGroupByPath.set(path, index)
      else union(previous, index)
    }
  })

  const members = new Map<number, number[]>()
  groups.forEach((_group, index) => {
    const root = find(index)
    const indexes = members.get(root) ?? []
    indexes.push(index)
    members.set(root, indexes)
  })
  return [...members.values()].map((indexes) => ({
    values: indexes.flatMap((index) => (groups[index] ? [groups[index].value] : [])),
    paths: [...new Set(indexes.flatMap((index) => groups[index]?.paths ?? []))],
  }))
}

export function chunkLiteralPathGroups<T>(
  groups: readonly LiteralPathGroup<T>[],
  budget: LiteralPathBudget,
  fixedArgs: readonly string[] = [],
): LiteralPathGroupChunks<T> {
  const batches: T[][] = []
  const oversized: T[] = []
  let currentValues: T[] = []
  let currentPaths: string[] = []

  for (const component of connectedLiteralPathGroups(groups)) {
    if (!literalPathsFit(component.paths, budget, fixedArgs)) {
      oversized.push(...component.values)
      continue
    }
    const combinedPaths = [...new Set([...currentPaths, ...component.paths])]
    if (currentValues.length > 0 && !literalPathsFit(combinedPaths, budget, fixedArgs)) {
      batches.push(currentValues)
      currentValues = []
      currentPaths = []
    }
    currentValues.push(...component.values)
    currentPaths.push(...component.paths)
  }
  if (currentValues.length > 0) batches.push(currentValues)
  return { batches, oversized }
}

export function nulRecords(raw: string): string[] {
  if (!raw) return []
  const records = raw.split("\0")
  if (records.at(-1) === "") records.pop()
  return records
}

export function pathAfterTab(record: string): string | undefined {
  const separator = record.indexOf("\t")
  return separator < 0 ? undefined : record.slice(separator + 1)
}
