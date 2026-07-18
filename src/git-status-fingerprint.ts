import { createHash } from "node:crypto"
import type { HeadState, StatusEntry } from "./git-status.js"

export interface StatusFingerprintInput {
  readonly head: HeadState
  readonly entries: readonly StatusEntry[]
  readonly untrackedPaths: readonly string[]
}

export function isWorkingTreeSnapshotClean(snapshot: StatusFingerprintInput): boolean {
  return snapshot.entries.length === 0 && snapshot.untrackedPaths.length === 0
}

export function workingTreeStatusFingerprint(snapshot: StatusFingerprintInput): string {
  const contentState = {
    head:
      snapshot.head.kind === "initial"
        ? [snapshot.head.kind, snapshot.head.branch]
        : snapshot.head.kind === "attached"
          ? [snapshot.head.kind, snapshot.head.oid, snapshot.head.branch]
          : [snapshot.head.kind, snapshot.head.oid],
    entries: snapshot.entries.map((entry) => [
      entry.kind,
      entry.path,
      entry.originalPath ?? null,
      entry.indexStatus,
      entry.worktreeStatus,
      entry.submodule,
      entry.similarity?.kind ?? null,
      entry.similarity?.score ?? null,
    ]),
    untrackedPaths: [...snapshot.untrackedPaths],
  }
  return createHash("sha256").update(JSON.stringify(contentState)).digest("hex")
}
