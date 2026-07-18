import type { WorkingTreeSnapshot } from "./git-status.js";
export declare function workingTreeContentIdentity(root: string, snapshot: WorkingTreeSnapshot, signal?: AbortSignal): Promise<string>;
