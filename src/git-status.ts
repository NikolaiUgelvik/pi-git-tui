import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, git } from "./git-service.js"
import type { GitExecResult } from "./types.js"

function branchWithCounts(branch: string, ahead: number, behind: number): string {
  const suffix = [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join(" ")
  return suffix ? `${branch} ${suffix}` : branch
}

function isMissingUpstream(result: GitExecResult): boolean {
  return /no upstream configured|no upstream branch|upstream branch .* not stored|does not point to a branch/iu.test(
    result.stderr,
  )
}

function parseUpstreamCounts(output: string): { ahead: number; behind: number } {
  const [behindText, aheadText, ...extra] = output.trim().split(/\s+/)
  const behind = Number(behindText)
  const ahead = Number(aheadText)
  if (extra.length > 0 || !Number.isFinite(behind) || !Number.isFinite(ahead)) {
    throw new Error(`git rev-list returned malformed upstream counts: ${output.trim() || "(empty)"}`)
  }
  return { ahead, behind }
}

export async function currentBranchStatusLabel(
  pi: ExtensionAPI,
  root: string,
  branch: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!branch || branch.startsWith("detached ")) {
    return branch
  }
  const args = ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]
  const result = await git(pi, root, args, signal)
  if (result.code === 128 && !result.killed && isMissingUpstream(result)) {
    return branch
  }
  assertGitSuccess(result, args, root)
  const { ahead, behind } = parseUpstreamCounts(result.stdout)
  return branchWithCounts(branch, ahead, behind)
}

export async function conflictedPaths(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<Set<string>> {
  const args = ["diff", "--name-only", "--diff-filter=U", "-z"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return new Set(result.stdout.split("\0").filter(Boolean))
}
