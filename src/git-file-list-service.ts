import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { git } from "./git-service.js"

export async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await git(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return []
  }
  return result.stdout.split("\0").filter(Boolean)
}

export async function listStagedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>> {
  const result = await git(pi, cwd, ["diff", "--cached", "--name-only", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return new Set()
  }
  return new Set(result.stdout.split("\0").filter(Boolean))
}
