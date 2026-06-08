import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { GIT_TIMEOUT_MS, type GitExecResult } from "./types.js"

export async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
  return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS })
}

export async function ensureGitRepository(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await git(pi, cwd, ["rev-parse", "--show-toplevel"], signal)
  if (result.code !== 0) {
    return
  }
  return result.stdout.trim()
}

export async function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  return root
}

export function compactGitOutput(result: GitExecResult): string {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
}

export function assertGitSuccess(result: GitExecResult, args: string[]): void {
  if (result.code !== 0) {
    throw new Error(compactGitOutput(result) || `git ${args.join(" ")} failed`)
  }
}
