import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorktreeSummary } from "./types.js";
export declare function parseWorktreeList(output: string): WorktreeSummary[];
export declare function getWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]>;
export declare function listWorktrees(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<WorktreeSummary[]>;
export declare function switchWorktree(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<string>;
