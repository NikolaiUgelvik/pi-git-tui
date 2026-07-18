import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { assertGitSuccess, git, requireGitRepository } from "./git-service.js"
import type { ForcePushPreview, GitCommand, GitExecResult, PushPreviewUpdate } from "./types.js"

class ForcePushPreviewError extends Error {
  readonly details: string

  constructor(message: string, details: string) {
    super(message)
    this.name = "ForcePushPreviewError"
    this.details = details
  }
}

export function redactPushDestination(destination: string): string {
  return destination.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, "$1")
}

function redactedPushResult(result: GitExecResult): GitExecResult {
  return {
    ...result,
    stdout: redactPushDestination(result.stdout),
    stderr: redactPushDestination(result.stderr),
  }
}

export function parseForcePushPreview(command: GitCommand, args: string[], result: GitExecResult): ForcePushPreview {
  const safeResult = redactedPushResult(result)
  const lines = [safeResult.stdout, safeResult.stderr]
    .join("\n")
    .split(/\r?\n/gu)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  const destinationLine = lines.find((line) => /^To\s+/u.test(line))
  const destination = destinationLine?.replace(/^To\s+/u, "").trim()
  if (!destination) {
    const details = [
      `Command: git ${args.join(" ")}`,
      "Git completed the dry run without reporting a push destination.",
      safeResult.stdout ? `\nstdout:\n${safeResult.stdout.trimEnd()}` : "",
      safeResult.stderr ? `\nstderr:\n${safeResult.stderr.trimEnd()}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    throw new ForcePushPreviewError("Force-push destination could not be resolved", details)
  }
  return {
    command: `git ${command.args.join(" ")}`,
    destination: redactPushDestination(destination),
    updates: lines.flatMap(parsePorcelainUpdate),
  }
}

function parsePorcelainUpdate(line: string): PushPreviewUpdate[] {
  const fields = line.split("\t")
  if (fields.length < 3 || fields[0] === undefined || fields[1] === undefined) {
    return []
  }
  const separator = fields[1].indexOf(":")
  if (separator < 0) {
    return []
  }
  return [
    {
      flag: fields[0] || " ",
      source: fields[1].slice(0, separator),
      destination: fields[1].slice(separator + 1),
      summary: fields.slice(2).join("\t"),
    },
  ]
}

export async function previewForcePush(
  pi: ExtensionAPI,
  cwd: string,
  command: GitCommand,
  signal?: AbortSignal,
): Promise<ForcePushPreview> {
  if (command.risk.kind !== "force-push") {
    throw new Error(`${command.label} does not require a force-push preview`)
  }
  const root = await requireGitRepository(pi, cwd, signal)
  const args = [...command.args, "--dry-run", "--porcelain"]
  const result = redactedPushResult(await git(pi, root, args, signal))
  assertGitSuccess(result, args, root)
  return parseForcePushPreview(command, args, result)
}
