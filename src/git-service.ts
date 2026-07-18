import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { GIT_TIMEOUT_MS, type GitExecResult } from "./types.js"

export type GitFailureReason = "exit" | "killed"

function renderedCommand(args: readonly string[]): string {
  return `git ${args.join(" ")}`
}

function resultSummary(result: GitExecResult): string | undefined {
  for (const output of [result.stderr, result.stdout]) {
    const firstLine = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean)
    if (firstLine) {
      return firstLine
    }
  }
}

function resultDetails(result: GitExecResult, args: readonly string[], cwd?: string): string {
  const lines = [`Command: ${renderedCommand(args)}`]
  if (cwd) {
    lines.push(`Working directory: ${cwd}`)
  }
  lines.push(`Exit code: ${result.code}${result.killed ? " (process killed or timed out)" : ""}`)
  if (result.stdout) {
    lines.push("", "stdout:", result.stdout.trimEnd())
  }
  if (result.stderr) {
    lines.push("", "stderr:", result.stderr.trimEnd())
  }
  return lines.join("\n")
}

export class GitCommandError extends Error {
  readonly args: readonly string[]
  readonly cwd?: string
  readonly details: string
  readonly reason: GitFailureReason
  readonly result: GitExecResult

  constructor(result: GitExecResult, args: readonly string[], cwd?: string) {
    const command = renderedCommand(args)
    const reason: GitFailureReason = result.killed ? "killed" : "exit"
    const fallback = result.killed ? `${command} was killed or timed out` : `${command} failed (exit ${result.code})`
    super(resultSummary(result) || fallback)
    this.name = "GitCommandError"
    this.args = [...args]
    this.cwd = cwd
    this.details = resultDetails(result, args, cwd)
    this.reason = reason
    this.result = result
  }
}

export async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
  return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS })
}

function isNotGitRepositoryResult(result: GitExecResult): boolean {
  return !result.killed && result.code === 128 && /not a git repository/iu.test(result.stderr)
}

export function isUnbornHeadResult(result: GitExecResult): boolean {
  if (result.killed || result.code !== 128) {
    return false
  }
  return /needed a single revision|unknown revision|bad revision|ambiguous argument ['"]?HEAD|(?:invalid|not a valid) object name ['"]?HEAD|does not have any commits yet/iu.test(
    result.stderr,
  )
}

export async function ensureGitRepository(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const args = ["rev-parse", "--show-toplevel"]
  const result = await git(pi, cwd, args, signal)
  if (result.killed) {
    throw new GitCommandError(result, args, cwd)
  }
  if (result.code === 0) {
    const root = result.stdout.trim()
    if (!root) {
      throw new Error(`git rev-parse returned an empty repository root for ${cwd}`)
    }
    return root
  }
  if (isNotGitRepositoryResult(result)) {
    return
  }
  throw new GitCommandError(result, args, cwd)
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

export function assertGitExitCode(
  result: GitExecResult,
  args: readonly string[],
  expectedCodes: readonly number[],
  cwd?: string,
): void {
  if (result.killed || !expectedCodes.includes(result.code)) {
    throw new GitCommandError(result, args, cwd)
  }
}

export function assertGitSuccess(result: GitExecResult, args: readonly string[], cwd?: string): void {
  assertGitExitCode(result, args, [0], cwd)
}
