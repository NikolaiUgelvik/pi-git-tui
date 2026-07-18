export const GIT_TIMEOUTS = {
    local: 10_000,
    mutation: 60_000,
    network: 5 * 60_000,
};
function commandLabel(args) {
    return args.length > 0 ? `git ${args.join(" ")}` : "git";
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
export class GitExitError extends Error {
    result;
    args;
    constructor(result, args, message) {
        super(message ?? (compactGitOutput(result) || `${commandLabel(args)} failed with exit code ${result.code}`));
        this.name = "GitExitError";
        this.result = result;
        this.args = [...args];
    }
}
export function isGitAbortError(error) {
    return error instanceof GitAbortError;
}
export function throwIfGitAborted(signal, args = [], timeoutClass = "local") {
    if (signal?.aborted) {
        throw new GitAbortError(args, timeoutClass);
    }
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
        if (options.signal?.aborted) {
            throw new GitAbortError(args, timeoutClass, { cause: error });
        }
        throw error;
    }
    if (result.killed) {
        if (options.signal?.aborted) {
            throw new GitAbortError(args, timeoutClass);
        }
        throw new GitTimeoutError(args, timeoutClass, timeout);
    }
    throwIfGitAborted(options.signal, args, timeoutClass);
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
export async function runGit(pi, cwd, args, options = {}) {
    const result = await executeGit(pi, cwd, args, options);
    assertGitSuccess(result, args, options.acceptedExitCodes);
    return result;
}
export function probeGit(pi, cwd, args, options = {}) {
    return executeGit(pi, cwd, args, options);
}
export async function ensureGitRepository(pi, cwd, signal) {
    const args = ["rev-parse", "--show-toplevel"];
    const result = await runGit(pi, cwd, args, { signal, acceptedExitCodes: [0, 128] });
    if (result.code === 128) {
        const output = compactGitOutput(result);
        if (/not a git repository/iu.test(output))
            return;
        throw new GitExitError(result, args);
    }
    return result.stdout.trim();
}
export async function hasHeadCommit(pi, root, signal) {
    const symbolic = await runGit(pi, root, ["symbolic-ref", "--quiet", "HEAD"], {
        signal,
        acceptedExitCodes: [0, 1],
    });
    if (symbolic.code === 0) {
        const ref = symbolic.stdout.trim();
        if (!ref)
            throw new Error("Git returned an empty symbolic HEAD");
        const exists = await runGit(pi, root, ["show-ref", "--verify", "--quiet", ref], {
            signal,
            acceptedExitCodes: [0, 1],
        });
        if (exists.code === 1)
            return false;
    }
    await runGit(pi, root, ["rev-parse", "--verify", "HEAD^{commit}"], { signal });
    return true;
}
export async function requireGitRepository(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        throw new Error("Not a git repository");
    }
    return root;
}
export function compactGitOutput(result) {
    return [result.stdout, result.stderr]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
}
export function assertGitSuccess(result, args, acceptedExitCodes = [0]) {
    if (!acceptedExitCodes.includes(result.code)) {
        throw new GitExitError(result, args);
    }
}
//# sourceMappingURL=git-service.js.map