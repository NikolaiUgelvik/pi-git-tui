import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type GitTimeoutClass = "local" | "mutation" | "network";
export interface GitCompletedResult {
    stdout: string;
    stderr: string;
    code: number;
}
export interface GitRunOptions {
    signal?: AbortSignal;
    timeoutClass?: GitTimeoutClass;
    timeoutMs?: number;
    acceptedExitCodes?: readonly number[];
}
export declare const GIT_TIMEOUTS: Readonly<Record<GitTimeoutClass, number>>;
export declare class GitKilledError extends Error {
    readonly args: readonly string[];
    readonly timeoutClass: GitTimeoutClass;
    constructor(message: string, args: readonly string[], timeoutClass: GitTimeoutClass, options?: ErrorOptions);
}
export declare class GitAbortError extends GitKilledError {
    constructor(args?: readonly string[], timeoutClass?: GitTimeoutClass, options?: ErrorOptions);
}
export declare class GitTimeoutError extends GitKilledError {
    readonly timeoutMs: number;
    constructor(args: readonly string[], timeoutClass: GitTimeoutClass, timeoutMs: number, options?: ErrorOptions);
}
export declare class GitExitError extends Error {
    readonly result: GitCompletedResult;
    readonly args: readonly string[];
    constructor(result: GitCompletedResult, args: readonly string[], message?: string);
}
export declare function isGitAbortError(error: unknown): error is GitAbortError;
export declare function throwIfGitAborted(signal?: AbortSignal, args?: readonly string[], timeoutClass?: GitTimeoutClass): void;
export declare function runGit(pi: ExtensionAPI, cwd: string, args: readonly string[], options?: GitRunOptions): Promise<GitCompletedResult>;
export declare function probeGit(pi: ExtensionAPI, cwd: string, args: readonly string[], options?: Omit<GitRunOptions, "acceptedExitCodes">): Promise<GitCompletedResult>;
export declare function ensureGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined>;
export declare function hasHeadCommit(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<boolean>;
export declare function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function compactGitOutput(result: Pick<GitCompletedResult, "stdout" | "stderr">): string;
export declare function assertGitSuccess(result: GitCompletedResult, args: readonly string[], acceptedExitCodes?: readonly number[]): void;
