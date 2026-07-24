import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TagSummary } from "./types.js";
export declare function parseTagList(output: string): TagSummary[];
export declare function getTags(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<TagSummary[]>;
export declare function createTag(pi: ExtensionAPI, cwd: string, name: string, target: string, annotated: boolean, message?: string, signal?: AbortSignal): Promise<string>;
