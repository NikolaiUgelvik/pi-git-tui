import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DiffDocument, WorkingTreeRefreshScope } from "./types.js";
export type WorkingTreeRefreshReason = "none" | "status-unchanged" | "requested-full" | "status-changed" | "missing-revision" | "unsafe-dirty-baseline" | "content-changed";
export interface WorkingTreeRefreshResult {
    readonly document: DiffDocument;
    readonly appliedScope: WorkingTreeRefreshScope;
    readonly reason: WorkingTreeRefreshReason;
}
export declare function refreshWorkingTreeDocument(pi: ExtensionAPI, ctx: ExtensionContext, current: DiffDocument, requested: WorkingTreeRefreshScope): Promise<WorkingTreeRefreshResult>;
