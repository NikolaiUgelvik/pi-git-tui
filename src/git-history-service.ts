import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, isUnbornHeadResult, probeGit, requireGitRepository, runGit } from "./git-service.js"
import { COMMIT_LIMIT, type CommitSummary } from "./types.js"

export async function getCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]> {
  const args = ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"]
  const result = await probeGit(pi, cwd, args, { signal })
  if (isUnbornHeadResult(result)) return []
  assertGitSuccess(result, args, cwd)
  if (!result.stdout.trim()) return []
  return result.stdout.split("\n").map((line) => {
    const [hash = "", ...messageParts] = line.split("\t")
    return { hash, message: messageParts.join("\t") }
  })
}

export { getCommits as loadCommits }

export async function getCommitMessage(
  pi: ExtensionAPI,
  cwd: string,
  hash: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  return (await runGit(pi, root, ["log", "-1", "--format=%s", hash], { signal })).stdout.trim()
}

export async function getCommitCount(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<number> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["rev-list", "--count", "HEAD"]
  const result = await probeGit(pi, root, args, { signal })
  if (isUnbornHeadResult(result)) return 0
  assertGitSuccess(result, args, root)
  const count = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isFinite(count)) {
    throw new Error(`git rev-list returned an invalid commit count: ${result.stdout.trim() || "(empty)"}`)
  }
  return count
}
