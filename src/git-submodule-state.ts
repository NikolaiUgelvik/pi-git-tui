import type { StatusEntry, WorkingTreeSnapshot } from "./git-status.js"

export function isSubmoduleState(value: string | undefined): boolean {
  return value?.startsWith("S") ?? false
}

export function hasNestedSubmoduleChanges(value: string | undefined): boolean {
  return isSubmoduleState(value) && (value?.[2] === "M" || value?.[3] === "U")
}

function entryMatchesPath(entry: StatusEntry, path: string): boolean {
  return entry.path === path || entry.originalPath === path
}

export function submoduleStateForPath(snapshot: WorkingTreeSnapshot, path: string): string | undefined {
  return snapshot.entries.find((entry) => entryMatchesPath(entry, path))?.submodule
}
