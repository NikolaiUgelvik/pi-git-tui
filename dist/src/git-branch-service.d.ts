import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BranchSummary } from "./types.js";
export declare function getBranches(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<BranchSummary[]>;
export declare function switchBranch(pi: ExtensionAPI, cwd: string, branch: string, signal?: AbortSignal): Promise<string>;
export declare function createAndSwitchBranch(pi: ExtensionAPI, cwd: string, name: string, signal?: AbortSignal): Promise<string>;
export declare function getBranchName(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined>;
