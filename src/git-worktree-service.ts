import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { probeGit, requireGitRepository, runGit } from "./git-service.js"
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
        if (key === "worktree") worktree.path = value
        else if (key === "HEAD") worktree.head = value
        else if (key === "branch") worktree.branch = worktreeBranchName(value)
        else if (key === "detached") worktree.detached = true
        else if (key === "bare") worktree.bare = true
      }
      return worktree
    })
    .filter((worktree) => worktree.path.length > 0)
}

export async function getWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const result = await runGit(pi, root, ["worktree", "list", "--porcelain"], { signal })
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
  const result = await probeGit(pi, root, ["worktree", "add", "-f", path, "--detach"], {
    signal,
    timeoutClass: "mutation",
  })
  return result.code === 0 ? `Created worktree at ${path}` : `Switched to worktree at ${path}`
}
