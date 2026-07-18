import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffFile } from "./types.js";
export { createAndSwitchBranch, getBranches as listBranches, switchBranch } from "./git-branch-service.js";
export { applyStash, dropStash, getStashes as listStashes, popStash, stashCurrentChanges, } from "./git-stash-service.js";
export { listWorktrees, parseWorktreeList } from "./git-worktree-service.js";
export type { WorktreeSummary } from "./types.js";
export declare function initializeGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function discardFileChanges(pi: ExtensionAPI, cwd: string, file: DiffFile, signal?: AbortSignal): Promise<string>;
