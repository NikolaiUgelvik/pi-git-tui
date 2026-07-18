import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CommitSummary } from "./types.js";
export declare function getCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]>;
export { getCommits as loadCommits };
export declare function getCommitMessage(pi: ExtensionAPI, cwd: string, hash: string, signal?: AbortSignal): Promise<string>;
export declare function getCommitCount(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<number>;
