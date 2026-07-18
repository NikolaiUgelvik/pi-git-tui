import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { GIT_TIMEOUT_MS, type GitExecResult } from "./types.js"

export type GitTimeoutClass = "local" | "mutation" | "network"
export type GitFailureReason = "exit" | "killed"

export interface GitCompletedResult {
  stdout: string
  stderr: string
  code: number
}

export interface GitRunOptions {
  signal?: AbortSignal
  timeoutClass?: GitTimeoutClass
  timeoutMs?: number
  acceptedExitCodes?: readonly number[]
}

export const GIT_TIMEOUTS: Readonly<Record<GitTimeoutClass, number>> = {
  local: GIT_TIMEOUT_MS,
  mutation: 60_000,
  network: 5 * 60_000,
}

function commandLabel(args: readonly string[]): string {
  return args.length > 0 ? `git ${args.join(" ")}` : "git"
}

function resultSummary(result: Pick<GitExecResult, "stdout" | "stderr">): string | undefined {
  for (const output of [result.stderr, result.stdout]) {
    const firstLine = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean)
    if (firstLine) return firstLine
  }
}

function resultDetails(result: GitExecResult, args: readonly string[], cwd?: string): string {
  const lines = [`Command: ${commandLabel(args)}`]
  if (cwd) lines.push(`Working directory: ${cwd}`)
  lines.push(`Exit code: ${result.code}${result.killed ? " (process killed or timed out)" : ""}`)
  if (result.stdout) lines.push("", "stdout:", result.stdout.trimEnd())
  if (result.stderr) lines.push("", "stderr:", result.stderr.trimEnd())
  return lines.join("\n")
}

export class GitCommandError extends Error {
  readonly args: readonly string[]
  readonly cwd?: string
  readonly details: string
  readonly reason: GitFailureReason
  readonly result: GitExecResult

  constructor(result: GitExecResult, args: readonly string[], cwd?: string) {
    const reason: GitFailureReason = result.killed ? "killed" : "exit"
    const fallback = result.killed
      ? `${commandLabel(args)} was killed or timed out`
      : `${commandLabel(args)} failed (exit ${result.code})`
    super(resultSummary(result) || fallback)
    this.name = "GitCommandError"
    this.args = [...args]
    this.cwd = cwd
    this.details = resultDetails(result, args, cwd)
    this.reason = reason
    this.result = result
  }
}

export class GitKilledError extends Error {
  readonly args: readonly string[]
  readonly timeoutClass: GitTimeoutClass

  constructor(message: string, args: readonly string[], timeoutClass: GitTimeoutClass, options?: ErrorOptions) {
    super(message, options)
    this.name = "GitKilledError"
    this.args = [...args]
    this.timeoutClass = timeoutClass
  }
}

export class GitAbortError extends GitKilledError {
  constructor(args: readonly string[] = [], timeoutClass: GitTimeoutClass = "local", options?: ErrorOptions) {
    super(`${commandLabel(args)} aborted`, args, timeoutClass, options)
    this.name = "GitAbortError"
  }
}

export class GitTimeoutError extends GitKilledError {
  readonly timeoutMs: number

  constructor(args: readonly string[], timeoutClass: GitTimeoutClass, timeoutMs: number, options?: ErrorOptions) {
    super(`${commandLabel(args)} timed out after ${timeoutMs}ms`, args, timeoutClass, options)
    this.name = "GitTimeoutError"
    this.timeoutMs = timeoutMs
  }
}

export class GitExitError extends GitCommandError {
  constructor(result: GitCompletedResult, args: readonly string[], message?: string, cwd?: string) {
    super({ ...result, killed: false }, args, cwd)
    this.name = "GitExitError"
    if (message) this.message = message
  }
}

export function isGitAbortError(error: unknown): error is GitAbortError {
  return error instanceof GitAbortError
}

export function throwIfGitAborted(
  signal?: AbortSignal,
  args: readonly string[] = [],
  timeoutClass: GitTimeoutClass = "local",
): void {
  if (signal?.aborted) throw new GitAbortError(args, timeoutClass)
}

async function executeGit(
  pi: ExtensionAPI,
  cwd: string,
  args: readonly string[],
  options: Omit<GitRunOptions, "acceptedExitCodes"> = {},
): Promise<GitCompletedResult> {
  const timeoutClass = options.timeoutClass ?? "local"
  const timeout = options.timeoutMs ?? GIT_TIMEOUTS[timeoutClass]
  throwIfGitAborted(options.signal, args, timeoutClass)

  let result: Awaited<ReturnType<ExtensionAPI["exec"]>>
  try {
    result = await pi.exec("git", [...args], { cwd, signal: options.signal, timeout })
  } catch (error) {
    if (options.signal?.aborted) throw new GitAbortError(args, timeoutClass, { cause: error })
    throw error
  }
  if (result.killed) {
    if (options.signal?.aborted) throw new GitAbortError(args, timeoutClass)
    throw new GitTimeoutError(args, timeoutClass, timeout)
  }
  throwIfGitAborted(options.signal, args, timeoutClass)
  return { stdout: result.stdout, stderr: result.stderr, code: result.code }
}

export async function runGit(
  pi: ExtensionAPI,
  cwd: string,
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<GitCompletedResult> {
  const result = await executeGit(pi, cwd, args, options)
  assertRunGitSuccess(result, args, options.acceptedExitCodes, cwd)
  return result
}

export function probeGit(
  pi: ExtensionAPI,
  cwd: string,
  args: readonly string[],
  options: Omit<GitRunOptions, "acceptedExitCodes"> = {},
): Promise<GitCompletedResult> {
  return executeGit(pi, cwd, args, options)
}

function isNotGitRepositoryResult(result: Pick<GitExecResult, "code" | "stderr" | "killed">): boolean {
  return !result.killed && result.code === 128 && /not a git repository/iu.test(result.stderr)
}

export function isUnbornHeadResult(result: GitExecResult | GitCompletedResult): boolean {
  if (("killed" in result && result.killed) || result.code !== 128) return false
  return /needed a single revision|unknown revision|bad revision|ambiguous argument ['"]?HEAD|(?:invalid|not a valid) object name ['"]?HEAD|does not have any commits yet/iu.test(
    result.stderr,
  )
}

export async function ensureGitRepository(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const args = ["rev-parse", "--show-toplevel"] as const
  const result = await runGit(pi, cwd, args, { signal, acceptedExitCodes: [0, 128] })
  if (result.code === 128) {
    const raw = { ...result, killed: false }
    if (isNotGitRepositoryResult(raw)) return
    throw new GitExitError(result, args, undefined, cwd)
  }
  const root = result.stdout.trim()
  if (!root) throw new Error(`git rev-parse returned an empty repository root for ${cwd}`)
  return root
}

export async function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) throw new Error("Not a git repository")
  return root
}

export function compactGitOutput(result: Pick<GitCompletedResult, "stdout" | "stderr">): string {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
}

function assertRunGitSuccess(
  result: GitCompletedResult,
  args: readonly string[],
  acceptedExitCodes: readonly number[] = [0],
  cwd?: string,
): void {
  if (!acceptedExitCodes.includes(result.code)) throw new GitExitError(result, args, undefined, cwd)
}

function assertGitExitCode(
  result: GitExecResult,
  args: readonly string[],
  expectedCodes: readonly number[],
  cwd?: string,
): void {
  if (result.killed) throw new GitCommandError(result, args, cwd)
  if (!expectedCodes.includes(result.code)) throw new GitExitError(result, args, undefined, cwd)
}

export function assertGitSuccess(
  result: GitCompletedResult | GitExecResult,
  args: readonly string[],
  acceptedExitCodesOrCwd: readonly number[] | string = [0],
  cwd?: string,
): void {
  const acceptedExitCodes = typeof acceptedExitCodesOrCwd === "string" ? [0] : acceptedExitCodesOrCwd
  const resolvedCwd = typeof acceptedExitCodesOrCwd === "string" ? acceptedExitCodesOrCwd : cwd
  if ("killed" in result) assertGitExitCode(result, args, acceptedExitCodes, resolvedCwd)
  else assertRunGitSuccess(result, args, acceptedExitCodes, resolvedCwd)
}
