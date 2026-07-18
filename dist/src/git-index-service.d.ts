import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffFile } from "./types.js";
export type IndexPathspec = string | readonly string[] | DiffFile;
export declare function stageRemainingFile(pi: ExtensionAPI, cwd: string, pathspec: IndexPathspec, signal?: AbortSignal): Promise<string>;
export declare function unstageFile(pi: ExtensionAPI, cwd: string, pathspec: IndexPathspec, signal?: AbortSignal): Promise<string>;
export declare function stageAllRemaining(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function unstageAll(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function getStagedPaths(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>>;
export declare function stagedDiffForCommitMessage(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
