import { GIT_TIMEOUT_MS } from "./types.js";
export const GIT_TIMEOUTS = {
    local: GIT_TIMEOUT_MS,
    mutation: 60_000,
    network: 5 * 60_000,
};
function commandLabel(args) {
    return args.length > 0 ? `git ${args.join(" ")}` : "git";
}
function resultSummary(result) {
    for (const output of [result.stderr, result.stdout]) {
        const firstLine = output
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find(Boolean);
        if (firstLine)
            return firstLine;
    }
}
function resultDetails(result, args, cwd) {
    const lines = [`Command: ${commandLabel(args)}`];
    if (cwd)
        lines.push(`Working directory: ${cwd}`);
    lines.push(`Exit code: ${result.code}${result.killed ? " (process killed or timed out)" : ""}`);
    if (result.stdout)
        lines.push("", "stdout:", result.stdout.trimEnd());
    if (result.stderr)
        lines.push("", "stderr:", result.stderr.trimEnd());
    return lines.join("\n");
}
export class GitCommandError extends Error {
    args;
    cwd;
    details;
    reason;
    result;
    constructor(result, args, cwd) {
        const reason = result.killed ? "killed" : "exit";
        const fallback = result.killed
            ? `${commandLabel(args)} was killed or timed out`
            : `${commandLabel(args)} failed (exit ${result.code})`;
        super(resultSummary(result) || fallback);
        this.name = "GitCommandError";
        this.args = [...args];
        this.cwd = cwd;
        this.details = resultDetails(result, args, cwd);
        this.reason = reason;
        this.result = result;
    }
}
export class GitKilledError extends Error {
    args;
    timeoutClass;
    constructor(message, args, timeoutClass, options) {
        super(message, options);
        this.name = "GitKilledError";
        this.args = [...args];
        this.timeoutClass = timeoutClass;
    }
}
export class GitAbortError extends GitKilledError {
    constructor(args = [], timeoutClass = "local", options) {
        super(`${commandLabel(args)} aborted`, args, timeoutClass, options);
        this.name = "GitAbortError";
    }
}
export class GitTimeoutError extends GitKilledError {
    timeoutMs;
    constructor(args, timeoutClass, timeoutMs, options) {
        super(`${commandLabel(args)} timed out after ${timeoutMs}ms`, args, timeoutClass, options);
        this.name = "GitTimeoutError";
        this.timeoutMs = timeoutMs;
    }
}
export class GitExitError extends GitCommandError {
    constructor(result, args, message, cwd) {
        super({ ...result, killed: false }, args, cwd);
        this.name = "GitExitError";
        if (message)
            this.message = message;
    }
}
export function isGitAbortError(error) {
    return error instanceof GitAbortError;
}
export function throwIfGitAborted(signal, args = [], timeoutClass = "local") {
    if (signal?.aborted)
        throw new GitAbortError(args, timeoutClass);
}
async function executeGit(pi, cwd, args, options = {}) {
    const timeoutClass = options.timeoutClass ?? "local";
    const timeout = options.timeoutMs ?? GIT_TIMEOUTS[timeoutClass];
    throwIfGitAborted(options.signal, args, timeoutClass);
    let result;
    try {
        result = await pi.exec("git", [...args], { cwd, signal: options.signal, timeout });
    }
    catch (error) {
        if (options.signal?.aborted)
            throw new GitAbortError(args, timeoutClass, { cause: error });
        throw error;
    }
    if (result.killed) {
        if (options.signal?.aborted)
            throw new GitAbortError(args, timeoutClass);
        throw new GitTimeoutError(args, timeoutClass, timeout);
    }
    throwIfGitAborted(options.signal, args, timeoutClass);
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
export async function runGit(pi, cwd, args, options = {}) {
    const result = await executeGit(pi, cwd, args, options);
    assertRunGitSuccess(result, args, options.acceptedExitCodes, cwd);
    return result;
}
export function probeGit(pi, cwd, args, options = {}) {
    return executeGit(pi, cwd, args, options);
}
function isNotGitRepositoryResult(result) {
    return !result.killed && result.code === 128 && /not a git repository/iu.test(result.stderr);
}
export function isUnbornHeadResult(result) {
    if (("killed" in result && result.killed) || result.code !== 128)
        return false;
    return /needed a single revision|unknown revision|bad revision|ambiguous argument ['"]?HEAD|(?:invalid|not a valid) object name ['"]?HEAD|does not have any commits yet/iu.test(result.stderr);
}
export async function ensureGitRepository(pi, cwd, signal) {
    const args = ["rev-parse", "--show-toplevel"];
    const result = await runGit(pi, cwd, args, { signal, acceptedExitCodes: [0, 128] });
    if (result.code === 128) {
        const raw = { ...result, killed: false };
        if (isNotGitRepositoryResult(raw))
            return;
        throw new GitExitError(result, args, undefined, cwd);
    }
    const root = result.stdout.trim();
    if (!root)
        throw new Error(`git rev-parse returned an empty repository root for ${cwd}`);
    return root;
}
export async function requireGitRepository(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    return root;
}
export function compactGitOutput(result) {
    return [result.stdout, result.stderr]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
}
function assertRunGitSuccess(result, args, acceptedExitCodes = [0], cwd) {
    if (!acceptedExitCodes.includes(result.code))
        throw new GitExitError(result, args, undefined, cwd);
}
function assertGitExitCode(result, args, expectedCodes, cwd) {
    if (result.killed)
        throw new GitCommandError(result, args, cwd);
    if (!expectedCodes.includes(result.code))
        throw new GitExitError(result, args, undefined, cwd);
}
export function assertGitSuccess(result, args, acceptedExitCodesOrCwd = [0], cwd) {
    const acceptedExitCodes = typeof acceptedExitCodesOrCwd === "string" ? [0] : acceptedExitCodesOrCwd;
    const resolvedCwd = typeof acceptedExitCodesOrCwd === "string" ? acceptedExitCodesOrCwd : cwd;
    if ("killed" in result)
        assertGitExitCode(result, args, acceptedExitCodes, resolvedCwd);
    else
        assertRunGitSuccess(result, args, acceptedExitCodes, resolvedCwd);
}
//# sourceMappingURL=git-service.js.map