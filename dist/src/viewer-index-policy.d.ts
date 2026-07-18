import type { DiffDocument, WorkingTreeView } from "./types.js";
export type CommitReviewIntent = {
    kind: "review";
} | {
    kind: "dialog";
} | {
    kind: "blocked";
    message: string;
};
export declare function commitReviewIntent(document: DiffDocument, view: WorkingTreeView): CommitReviewIntent;
export declare function stagingBlockReason(document: DiffDocument): string | undefined;
