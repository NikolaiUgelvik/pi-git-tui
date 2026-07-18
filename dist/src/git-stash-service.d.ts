import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { StashSummary } from "./types.js";
export declare function stashCurrentChanges(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function getStashes(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<StashSummary[]>;
export declare function applyStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string>;
export declare function popStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string>;
export declare function dropStash(pi: ExtensionAPI, cwd: string, ref: string, signal?: AbortSignal): Promise<string>;
