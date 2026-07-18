import type { TrackedDiffBudget } from "./diff-budgets.js";
import type { WorkingTreeSnapshot } from "./git-status.js";
import { type TrackedGroup } from "./git-tracked-selection.js";
import type { DiffFile } from "./types.js";
export interface TrackedPatchChunk {
    readonly raw: string;
    readonly file: DiffFile;
    readonly groupIndexes: readonly number[];
    readonly bytes: number;
    readonly lines: number;
}
export declare function retainTrackedPatchChunks(raw: string, chunks: readonly TrackedPatchChunk[], groups: readonly TrackedGroup[], snapshot: WorkingTreeSnapshot, changed: ReadonlySet<number>, omissions: Map<number, DiffFile>, budget: TrackedDiffBudget): string;
