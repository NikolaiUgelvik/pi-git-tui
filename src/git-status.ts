import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { GIT_TIMEOUT_MS, type GitExecResult } from "./types.js"

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
  return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS })
}

function branchWithCounts(branch: string, ahead: number, behind: number): string {
  const suffix = [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join(" ")
  return suffix ? `${branch} ${suffix}` : branch
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
  const result = await git(pi, root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], signal)
  if (result.code !== 0) {
    return branch
  }
  const [behindText = "0", aheadText = "0"] = result.stdout.trim().split(/\s+/)
  return branchWithCounts(branch, Number(aheadText) || 0, Number(behindText) || 0)
}

export async function conflictedPaths(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<Set<string>> {
  const result = await git(pi, root, ["diff", "--name-only", "--diff-filter=U", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return new Set()
  }
  return new Set(result.stdout.split("\0").filter(Boolean))
}
