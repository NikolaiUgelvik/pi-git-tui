import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export type GitTimeoutClass = "local" | "mutation" | "network"

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
  local: 10_000,
  mutation: 60_000,
  network: 5 * 60_000,
}

function commandLabel(args: readonly string[]): string {
  return args.length > 0 ? `git ${args.join(" ")}` : "git"
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

export class GitExitError extends Error {
  readonly result: GitCompletedResult
  readonly args: readonly string[]

  constructor(result: GitCompletedResult, args: readonly string[], message?: string) {
    super(message ?? (compactGitOutput(result) || `${commandLabel(args)} failed with exit code ${result.code}`))
    this.name = "GitExitError"
    this.result = result
    this.args = [...args]
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
  if (signal?.aborted) {
    throw new GitAbortError(args, timeoutClass)
  }
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
    if (options.signal?.aborted) {
      throw new GitAbortError(args, timeoutClass, { cause: error })
    }
    throw error
  }

  if (result.killed) {
    if (options.signal?.aborted) {
      throw new GitAbortError(args, timeoutClass)
    }
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
  assertGitSuccess(result, args, options.acceptedExitCodes)
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

export async function ensureGitRepository(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const args = ["rev-parse", "--show-toplevel"] as const
  const result = await runGit(pi, cwd, args, { signal, acceptedExitCodes: [0, 128] })
  if (result.code === 128) {
    const output = compactGitOutput(result)
    if (/not a git repository/iu.test(output)) return
    throw new GitExitError(result, args)
  }
  return result.stdout.trim()
}

export async function hasHeadCommit(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<boolean> {
  const symbolic = await runGit(pi, root, ["symbolic-ref", "--quiet", "HEAD"], {
    signal,
    acceptedExitCodes: [0, 1],
  })
  if (symbolic.code === 0) {
    const ref = symbolic.stdout.trim()
    if (!ref) throw new Error("Git returned an empty symbolic HEAD")
    const exists = await runGit(pi, root, ["show-ref", "--verify", "--quiet", ref], {
      signal,
      acceptedExitCodes: [0, 1],
    })
    if (exists.code === 1) return false
  }
  await runGit(pi, root, ["rev-parse", "--verify", "HEAD^{commit}"], { signal })
  return true
}

export async function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  return root
}

export function compactGitOutput(result: Pick<GitCompletedResult, "stdout" | "stderr">): string {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
}

export function assertGitSuccess(
  result: GitCompletedResult,
  args: readonly string[],
  acceptedExitCodes: readonly number[] = [0],
): void {
  if (!acceptedExitCodes.includes(result.code)) {
    throw new GitExitError(result, args)
  }
}
