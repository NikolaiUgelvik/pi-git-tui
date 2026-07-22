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
export declare const GIT_TIMEOUT_MS = 10000;
export declare const COMMIT_MESSAGE_TIMEOUT_MS = 60000;
export declare const MAX_UNTRACKED_FILE_BYTES: number;
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
export type DiffScope = "working" | "staged" | "commit";
export type WorkingTreeView = Exclude<DiffScope, "commit">;
export type RepositoryState = "ready" | "missing";
export type HeadState = "present" | "unborn";
export type FileStageState = "unstaged" | "staged" | "mixed" | "conflicted";
export type WorkingTreeRefreshScope = "none" | "status" | "full";
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
export type GitCommandRisk = {
    kind: "normal";
} | {
    kind: "force-push";
};
export interface GitCommand {
    readonly label: string;
    readonly description: string;
    readonly args: readonly string[];
    readonly risk: GitCommandRisk;
    readonly refreshDiff?: boolean;
    readonly refresh?: {
        readonly success: WorkingTreeRefreshScope;
        readonly failure: WorkingTreeRefreshScope;
    };
}
export interface PushPreviewUpdate {
    flag: string;
    source: string;
    destination: string;
    summary: string;
}
export interface ForcePushPreview {
    command: string;
    destination: string;
    updates: PushPreviewUpdate[];
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
    stageState?: FileStageState;
    /** Compatibility metadata used while decorating bounded captures. */
    staged?: boolean;
    untracked?: boolean;
    untrackedRole?: "replacement" | "rename-source";
    submodule?: string;
    lines: string[];
    omission?: DiffOmission;
}
export interface DiffStats {
    files: number;
    additions: number;
    deletions: number;
}
export interface DiffSlice {
    scope: DiffScope;
    raw: string;
    files: DiffFile[];
    stats: DiffStats;
    omittedFileCount: number;
    capturedPatchBytes: number;
    capturedPatchLines: number;
}
export interface DiffDocumentBase {
    title: string;
    subtitle: string;
    repositoryState: RepositoryState;
    headState: HeadState;
    /** Flat compatibility view used by performance instrumentation. */
    raw: string;
    files: DiffFile[];
    omittedFileCount: number;
    capturedPatchBytes: number;
    capturedPatchLines: number;
}
export interface WorkingTreeDocument extends DiffDocumentBase {
    mode: "working";
    working: DiffSlice;
    staged: DiffSlice;
    revision?: WorkingTreeRevision;
}
export interface CommitDocument extends DiffDocumentBase {
    mode: "commit";
    diff: DiffSlice;
    commit: CommitSummary;
}
export type DiffDocument = WorkingTreeDocument | CommitDocument;
export interface GitExecResult {
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
}
export type FocusPanel = "tree" | "diff";
export type HelpContext = "viewer" | "commitPicker" | "commandMenu" | "commitDialog" | "confirmDialog" | "branchPicker" | "stashPicker" | "worktreePicker" | "settings";
export type ThemeColor = Parameters<Theme["fg"]>[0];
export declare const TREE_STATUS_COLORS: Record<DiffFile["status"], ThemeColor>;
export declare const GIT_COMMANDS: GitCommand[];
export type StashConfirm = "pop" | "drop";
export type ConfirmAction = "init" | "discard";
