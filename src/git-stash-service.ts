import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, compactGitOutput, git, requireGitRepository } from "./git-service.js"
import type { StashSummary } from "./types.js"

export async function stashCurrentChanges(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "push", "-u", "-m", "WIP from pi-git"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return compactGitOutput(result) || "Stashed current changes"
}

export async function getStashes(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<StashSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "list", "--format=%gd%x00%s"]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args, root)
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref = "", message = ""] = line.split("\0")
      return { ref, message }
    })
}

export async function applyStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "apply", ref]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
  return `Applied ${ref}`
}

export async function popStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "pop", ref]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
  return `Popped ${ref}`
}

export async function dropStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const args = ["stash", "drop", ref]
  assertGitSuccess(await git(pi, root, args, signal), args, root)
  return `Dropped ${ref}`
}
