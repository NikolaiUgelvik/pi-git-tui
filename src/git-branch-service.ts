import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, git, requireGitRepository } from "./git-service.js"
import type { BranchSummary } from "./types.js"

export async function getBranches(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<BranchSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const format = "%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)"
  const result = await git(pi, root, ["branch", "--format", format], signal)
  assertGitSuccess(result, ["branch", "--format", format])
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", head = "", upstream = "", track = ""] = line.split("\0")
      return { name, current: head.trim() === "*", upstream: upstream || undefined, track: track || undefined }
    })
}

export async function switchBranch(
  pi: ExtensionAPI,
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["switch", branch]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Switched to ${branch}`
}

export async function createAndSwitchBranch(
  pi: ExtensionAPI,
  cwd: string,
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["switch", "-c", name]
  assertGitSuccess(await git(pi, root, args, signal), args)
  return `Created and switched to ${name}`
}

export async function getBranchName(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const root = await requireGitRepository(pi, cwd, signal)
  const branchResult = await git(pi, root, ["branch", "--show-current"], signal)
  if (branchResult.code === 0 && branchResult.stdout.trim()) {
    return branchResult.stdout.trim()
  }
  const headResult = await git(pi, root, ["rev-parse", "--short", "HEAD"], signal)
  if (headResult.code === 0 && headResult.stdout.trim()) {
    return `detached ${headResult.stdout.trim()}`
  }
  return undefined
}
