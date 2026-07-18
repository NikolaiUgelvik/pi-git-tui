import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, git, requireGitRepository } from "./git-service.js"
import type { WorktreeSummary } from "./types.js"

function worktreeBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//u, "")
}

export function parseWorktreeList(output: string): WorktreeSummary[] {
  return output
    .split(/\n\s*\n/u)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const worktree: WorktreeSummary = { path: "" }
      for (const line of record.split("\n")) {
        const [key = "", ...valueParts] = line.split(" ")
        const value = valueParts.join(" ")
        if (key === "worktree") {
          worktree.path = value
        } else if (key === "HEAD") {
          worktree.head = value
        } else if (key === "branch") {
          worktree.branch = worktreeBranchName(value)
        } else if (key === "detached") {
          worktree.detached = true
        } else if (key === "bare") {
          worktree.bare = true
        }
      }
      return worktree
    })
    .filter((worktree) => worktree.path.length > 0)
}

export async function getWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["worktree", "list", "--porcelain"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return parseWorktreeList(result.stdout)
}

export async function listWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]> {
  return getWorktrees(pi, cwd, signal)
}

export async function switchWorktree(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["worktree", "add", "-f", path, "--detach"]
  const result = await git(pi, root, args, signal)
  if (result.code === 0) {
    return `Created worktree at ${path}`
  }
  // Worktree may already exist; just return the path
  return `Switched to worktree at ${path}`
}
