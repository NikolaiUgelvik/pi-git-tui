import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { compactGitOutput, ensureGitRepository, runGit } from "./git-service.js"
import type { GitCommand } from "./types.js"

export async function runGitCommand(
  pi: ExtensionAPI,
  cwd: string,
  command: GitCommand,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) throw new Error("Not a git repository")
  const result = await runGit(pi, root, command.args, { signal, timeoutClass: "network" })
  const output = compactGitOutput(result)
  return output ? `${command.label} complete: ${output}` : `${command.label} complete`
}
