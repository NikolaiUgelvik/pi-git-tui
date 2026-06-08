import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { ensureGitRepository, git } from "./git-service.js"
import type { CommitSummary } from "./types.js"
import { COMMIT_LIMIT } from "./types.js"

export async function getCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return []
  }
  const result = await git(pi, root, ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"], signal)
  if (result.code !== 0 || !result.stdout.trim()) {
    return []
  }
  return result.stdout.split("\n").map((line) => {
    const [hash = "", ...messageParts] = line.split("\t")
    return { hash, message: messageParts.join("\t") }
  })
}

// Alias for loadCommits (public API name used by viewer-commit-picker.ts)
export { getCommits as loadCommits }

export async function getCommitMessage(
  pi: ExtensionAPI,
  cwd: string,
  hash: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return ""
  }
  const result = await git(pi, root, ["log", "-1", "--format=%s", hash], signal)
  if (result.code !== 0) {
    return ""
  }
  return result.stdout.trim()
}

export async function getCommitCount(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<number> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return 0
  }
  const result = await git(pi, root, ["rev-list", "--count", "HEAD"], signal)
  if (result.code !== 0) {
    return 0
  }
  return parseInt(result.stdout.trim(), 10) || 0
}
