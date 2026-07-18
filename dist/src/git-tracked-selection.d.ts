import type { TrackedDiffBudget } from "./diff-budgets.js";
import { omittedDiffFile } from "./diff-omission.js";
import type { GitFileState } from "./git-file-state.js";
import type { IndexPathSizes } from "./git-object-sizes.js";
import type { StatusEntry, WorkingTreeSnapshot } from "./git-status.js";
import type { DiffFile, DiffOmissionReason } from "./types.js";
export interface TrackedGroup {
    readonly index: number;
    readonly entry: StatusEntry;
    readonly paths: readonly string[];
}
export interface SelectedGroup extends TrackedGroup {
    readonly sourceBytes: number;
}
export declare function trackedGroups(snapshot: WorkingTreeSnapshot): TrackedGroup[];
export declare function omittedTrackedGroup(group: TrackedGroup, snapshot: WorkingTreeSnapshot, reason: DiffOmissionReason, details?: Omit<Parameters<typeof omittedDiffFile>[0], "path" | "reason" | "status" | "staged">): DiffFile;
export declare function selectTrackedGroups(groups: readonly TrackedGroup[], snapshot: WorkingTreeSnapshot, headSizes: ReadonlyMap<string, number>, states: ReadonlyMap<string, GitFileState>, indexSizes: IndexPathSizes | undefined, scope: "combined" | "staged" | "working", budget: TrackedDiffBudget, omissions: Map<number, DiffFile>, signal?: AbortSignal): SelectedGroup[];
