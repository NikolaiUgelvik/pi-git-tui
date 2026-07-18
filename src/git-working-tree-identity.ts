import { createHash } from "node:crypto"
import { loadGitFileState } from "./git-file-state.js"
import type { WorkingTreeSnapshot } from "./git-status.js"
import { mapGitWorkers } from "./git-worker-pool.js"

const FILE_STATE_CONCURRENCY = 16

function snapshotPaths(snapshot: WorkingTreeSnapshot): string[] {
  return [
    ...new Set([
      ...snapshot.entries.flatMap((entry) =>
        entry.originalPath === undefined ? [entry.path] : [entry.originalPath, entry.path],
      ),
      ...snapshot.untrackedPaths,
    ]),
  ]
}

export async function workingTreeContentIdentity(
  root: string,
  snapshot: WorkingTreeSnapshot,
  signal?: AbortSignal,
): Promise<string> {
  const paths = snapshotPaths(snapshot)
  const states = await mapGitWorkers(paths, FILE_STATE_CONCURRENCY, (path) => loadGitFileState(root, path), signal)
  const content = {
    index: snapshot.indexFingerprint,
    files: paths.map((path, index) => [path, states[index]]),
  }
  return createHash("sha256").update(JSON.stringify(content)).digest("hex")
}
