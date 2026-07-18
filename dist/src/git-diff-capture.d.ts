import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TrackedDiffBudget } from "./diff-budgets.js";
import type { WorkingTreeSnapshot } from "./git-status.js";
import type { DiffFile } from "./types.js";
export interface TrackedDiffCapture {
    readonly raw: string;
    readonly omittedFiles: readonly DiffFile[];
    readonly capturedPatchBytes: number;
    readonly capturedPatchLines: number;
}
export type TrackedDiffCaptureScope = "combined" | "staged" | "working";
export declare function captureTrackedDiff(pi: ExtensionAPI, root: string, snapshot: WorkingTreeSnapshot, budget?: TrackedDiffBudget, signal?: AbortSignal, scope?: TrackedDiffCaptureScope): Promise<TrackedDiffCapture>;
