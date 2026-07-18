import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type UntrackedDiffBudget } from "./diff-budgets.js";
import type { WorkingTreeSnapshot } from "./git-status.js";
import type { DiffOmission, DiffOmissionReason } from "./types.js";
export type UntrackedDiffResult = {
    kind: "patch";
    path: string;
    raw: string;
    bytes: number;
    lines: number;
} | {
    kind: "omitted";
    path: string;
    reason: DiffOmissionReason;
    bytes?: number;
    omission: DiffOmission;
};
export declare function loadUntrackedDiffs(pi: ExtensionAPI, root: string, snapshot: WorkingTreeSnapshot, budget?: UntrackedDiffBudget, signal?: AbortSignal): Promise<UntrackedDiffResult[]>;
