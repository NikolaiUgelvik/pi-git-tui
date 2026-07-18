import type { WorkingTreeSnapshot } from "./git-status.js";
export declare function isSubmoduleState(value: string | undefined): boolean;
export declare function hasNestedSubmoduleChanges(value: string | undefined): boolean;
export declare function submoduleStateForPath(snapshot: WorkingTreeSnapshot, path: string): string | undefined;
