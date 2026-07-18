import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { runGit } from "./git-service.js"

export async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runGit(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { signal })
  return result.stdout ? result.stdout.split("\0").filter(Boolean) : []
}

export async function listStagedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>> {
  const result = await runGit(pi, cwd, ["diff", "--cached", "--name-only", "-z"], { signal })
  return new Set(result.stdout ? result.stdout.split("\0").filter(Boolean) : [])
}
