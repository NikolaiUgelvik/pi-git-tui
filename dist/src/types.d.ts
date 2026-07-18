import type { Theme } from "@earendil-works/pi-coding-agent";
export interface BranchSummary {
    name: string;
    current: boolean;
    upstream?: string;
    track?: string;
}
export interface StashSummary {
    ref: string;
    message: string;
}
export interface WorktreeSummary {
    path: string;
    head?: string;
    branch?: string;
    detached?: boolean;
    bare?: boolean;
}
export declare const COMMIT_LIMIT = 200;
export type DiffOmissionReason = "file-too-large" | "file-count-budget" | "aggregate-byte-budget" | "aggregate-line-budget" | "unsupported-file" | "changed-during-load" | "capture-overflow";
export interface DiffOmission {
    reason: DiffOmissionReason;
    measuredBytes?: number;
    limitBytes?: number;
    measuredLines?: number;
    limitLines?: number;
    limitFiles?: number;
    message: string;
}
export type DiffMode = "working" | "commit";
export type RepositoryState = "ready" | "missing";
export interface CommitSummary {
    hash: string;
    message: string;
}
export type CommitPickerItem = {
    type: "working";
} | {
    type: "commit";
    commit: CommitSummary;
};
export type WorkingTreeRefreshScope = "none" | "status" | "full";
export interface GitCommand {
    readonly label: string;
    readonly description: string;
    readonly args: readonly string[];
    readonly refresh: {
        readonly success: WorkingTreeRefreshScope;
        readonly failure: WorkingTreeRefreshScope;
    };
}
export interface WorkingTreeRevision {
    readonly root: string;
    readonly statusFingerprint: string;
    readonly contentIdentity: string;
    readonly clean: boolean;
}
export interface DiffFile {
    path: string;
    oldPath?: string;
    newPath?: string;
    status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary" | "conflicted";
    staged: boolean;
    untracked?: boolean;
    untrackedRole?: "replacement" | "rename-source";
    submodule?: string;
    lines: string[];
    omission?: DiffOmission;
}
export interface DiffDocument {
    mode: DiffMode;
    title: string;
    subtitle: string;
    raw: string;
    files: DiffFile[];
    omittedFileCount: number;
    capturedPatchBytes: number;
    capturedPatchLines: number;
    commit?: CommitSummary;
    repositoryState?: RepositoryState;
    revision?: WorkingTreeRevision;
}
export type FocusPanel = "tree" | "diff";
export type HelpContext = "viewer" | "commitPicker" | "commandMenu" | "commitDialog" | "confirmDialog" | "branchPicker" | "stashPicker" | "worktreePicker";
export type ThemeColor = Parameters<Theme["fg"]>[0];
export declare const TREE_STATUS_COLORS: Record<DiffFile["status"], ThemeColor>;
export declare const GIT_COMMANDS: GitCommand[];
/** Stash confirmation action choice. */
export type StashConfirm = "pop" | "drop";
/** Confirmation dialog action choice. */
export type ConfirmAction = "init" | "discard";
