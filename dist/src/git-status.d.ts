import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type SnapshotHeadState = {
    kind: "initial";
    branch: string;
} | {
    kind: "attached";
    oid: string;
    branch: string;
} | {
    kind: "detached";
    oid: string;
};
export interface StatusEntry {
    kind: "ordinary" | "rename" | "unmerged";
    path: string;
    originalPath?: string;
    indexStatus: string;
    worktreeStatus: string;
    submodule: string;
    similarity?: {
        kind: "rename" | "copy";
        score: number;
    };
}
export interface WorkingTreeSnapshot {
    head: SnapshotHeadState;
    upstream?: {
        name: string;
        ahead?: number;
        behind?: number;
    };
    entries: StatusEntry[];
    stagedPaths: Set<string>;
    conflictedPaths: Set<string>;
    untrackedPaths: string[];
    headTrackedPaths: Set<string>;
    readonly indexFingerprint: string;
    readonly statusFingerprint: string;
    readonly clean: boolean;
}
export declare class GitStatusParseError extends Error {
    readonly record?: string;
    constructor(message: string, record?: string);
}
export declare function parsePorcelainV2(raw: string): WorkingTreeSnapshot;
export declare function workingTreeBranchLabel(snapshot: WorkingTreeSnapshot): string;
export declare function loadWorkingTreeSnapshot(pi: ExtensionAPI, root: string, signal?: AbortSignal): Promise<WorkingTreeSnapshot>;
