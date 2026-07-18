import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TrackedDiffBudget } from "./diff-budgets.js";
import type { DiffFile } from "./types.js";
export interface HistoricalDiffCapture {
    readonly commitOid: string;
    readonly raw: string;
    readonly omittedFiles: readonly DiffFile[];
    readonly omittedFileCount: number;
    readonly capturedPatchBytes: number;
    readonly capturedPatchLines: number;
}
export declare function captureHistoricalDiff(pi: ExtensionAPI, root: string, revision: string, budget?: TrackedDiffBudget, signal?: AbortSignal): Promise<HistoricalDiffCapture>;
