import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, git } from "./git-service.js"

export async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const args = ["ls-files", "--others", "--exclude-standard", "-z"]
  const result = await git(pi, cwd, args, signal)
  assertGitSuccess(result, args, cwd)
  return result.stdout.split("\0").filter(Boolean)
}

export async function listStagedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>> {
  const args = ["diff", "--cached", "--name-only", "-z"]
  const result = await git(pi, cwd, args, signal)
  assertGitSuccess(result, args, cwd)
  return new Set(result.stdout.split("\0").filter(Boolean))
}
