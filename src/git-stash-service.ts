import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { compactGitOutput, requireGitRepository, runGit } from "./git-service.js"
import type { StashSummary } from "./types.js"

export async function stashCurrentChanges(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  const result = await runGit(pi, root, ["stash", "push", "-u", "-m", "WIP from pi-git-tui"], {
    signal,
    timeoutClass: "mutation",
  })
  return compactGitOutput(result) || "Stashed current changes"
}

export async function getStashes(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<StashSummary[]> {
  const root = await requireGitRepository(pi, cwd, signal)
  const result = await runGit(pi, root, ["stash", "list", "--format=%gd%x00%s"], { signal })
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
  await runGit(pi, root, ["stash", "apply", ref], { signal, timeoutClass: "mutation" })
  return `Applied ${ref}`
}

export async function popStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  await runGit(pi, root, ["stash", "pop", ref], { signal, timeoutClass: "mutation" })
  return `Popped ${ref}`
}

export async function dropStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string> {
  const root = await requireGitRepository(pi, cwd, signal)
  await runGit(pi, root, ["stash", "drop", ref], { signal, timeoutClass: "mutation" })
  return `Dropped ${ref}`
}
