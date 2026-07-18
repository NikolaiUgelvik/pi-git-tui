import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffFile } from "./types.js";
export declare function stageOrUnstageFile(pi: ExtensionAPI, cwd: string, selection: string | DiffFile, signal?: AbortSignal): Promise<string>;
export declare function toggleAllChangesStaged(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function getStagedPaths(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>>;
