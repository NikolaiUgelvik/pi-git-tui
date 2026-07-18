import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDiffOmission } from "./diff-omission.js";
import type { DiffOmission, DiffOmissionReason } from "./types.js";
export interface StagedSelectionBudget {
    readonly concurrency: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
}
export interface StagedEntry {
    readonly index: number;
    readonly status: string;
    readonly oldMode: string;
    readonly newMode: string;
    readonly oldOid: string;
    readonly newOid: string;
    readonly path: string;
    readonly originalPath?: string;
    readonly paths: readonly string[];
}
export interface SizedEntry extends StagedEntry {
    readonly sourceBytes: number;
}
export interface CommitOmission {
    readonly index: number;
    readonly path: string;
    readonly omission: DiffOmission;
}
export declare class StagedRawEntryDecoder {
    private metadata;
    private firstPath;
    private nextIndex;
    push(record: string): StagedEntry | undefined;
    finish(): void;
}
export declare function parseStagedRawDiff(raw: string): StagedEntry[];
export declare function loadStagedEntries(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<{
    raw: string;
    entries: StagedEntry[];
}>;
export declare function commitOmission(index: number, path: string, reason: DiffOmissionReason, details?: Parameters<typeof createDiffOmission>[1]): CommitOmission;
export declare function loadBoundedStagedEntries(pi: ExtensionAPI, root: string, entries: readonly StagedEntry[], budget: StagedSelectionBudget, omissions: Map<number, CommitOmission>, signal?: AbortSignal): Promise<SizedEntry[]>;
