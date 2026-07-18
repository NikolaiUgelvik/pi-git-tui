import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GitExecResult } from "./types.js";
export type GitTimeoutClass = "local" | "mutation" | "network";
export type GitFailureReason = "exit" | "killed";
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
export declare class GitCommandError extends Error {
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly details: string;
    readonly reason: GitFailureReason;
    readonly result: GitExecResult;
    constructor(result: GitExecResult, args: readonly string[], cwd?: string);
}
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
export declare class GitExitError extends GitCommandError {
    constructor(result: GitCompletedResult, args: readonly string[], message?: string, cwd?: string);
}
export declare function isGitAbortError(error: unknown): error is GitAbortError;
export declare function throwIfGitAborted(signal?: AbortSignal, args?: readonly string[], timeoutClass?: GitTimeoutClass): void;
export declare function runGit(pi: ExtensionAPI, cwd: string, args: readonly string[], options?: GitRunOptions): Promise<GitCompletedResult>;
export declare function probeGit(pi: ExtensionAPI, cwd: string, args: readonly string[], options?: Omit<GitRunOptions, "acceptedExitCodes">): Promise<GitCompletedResult>;
export declare function isUnbornHeadResult(result: GitExecResult | GitCompletedResult): boolean;
export declare function ensureGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined>;
export declare function requireGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function compactGitOutput(result: Pick<GitCompletedResult, "stdout" | "stderr">): string;
export declare function assertGitSuccess(result: GitCompletedResult | GitExecResult, args: readonly string[], acceptedExitCodesOrCwd?: readonly number[] | string, cwd?: string): void;
