import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type WorkingTreeSnapshot } from "./git-status.js";
import type { CommitDocument, CommitSummary, WorkingTreeDocument, WorkingTreeRevision } from "./types.js";
export declare function workingTreeDocumentTitle(snapshot: WorkingTreeSnapshot): string;
export declare function workingTreeDocumentSubtitle(root: string, snapshot: WorkingTreeSnapshot): string;
export declare function workingTreeRevision(root: string, snapshot: WorkingTreeSnapshot, contentIdentity: string): WorkingTreeRevision;
export declare function loadWorkingTreeDiffFromSnapshot(pi: ExtensionAPI, root: string, snapshot: WorkingTreeSnapshot, signal?: AbortSignal): Promise<WorkingTreeDocument>;
export declare function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkingTreeDocument>;
export declare const loadWorkingTreeDocument: typeof loadWorkingTreeDiff;
export interface CommitDocumentRequest {
    cwd: string;
    commit: CommitSummary;
    signal?: AbortSignal;
}
export declare function loadCommitDocument(pi: ExtensionAPI, request: CommitDocumentRequest): Promise<CommitDocument>;
export declare function getStagedDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string>;
export declare function getCommitRangeDiff(pi: ExtensionAPI, cwd: string, from: string, to: string, signal?: AbortSignal): Promise<string>;
