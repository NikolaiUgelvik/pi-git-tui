import type { CommitDocument, CommitSummary, DiffDocument, DiffFile, DiffScope, DiffSlice, HeadState, RepositoryState, WorkingTreeDocument, WorkingTreeRevision, WorkingTreeView } from "./types.js";
export interface WorkingTreeDocumentInput {
    title: string;
    subtitle: string;
    stagedRaw: string;
    workingRaw: string;
    untrackedPaths?: Iterable<string>;
    conflictedPaths?: Iterable<string>;
    stagedOmittedFiles?: readonly DiffFile[];
    workingOmittedFiles?: readonly DiffFile[];
    stagedCapture?: {
        bytes: number;
        lines: number;
    };
    workingCapture?: {
        bytes: number;
        lines: number;
    };
    repositoryState?: RepositoryState;
    headState: HeadState;
    revision?: WorkingTreeRevision;
}
export interface CommitDocumentInput {
    title: string;
    subtitle: string;
    raw: string;
    commit: CommitSummary;
    headState?: HeadState;
    omittedFiles?: readonly DiffFile[];
    capture?: {
        bytes: number;
        lines: number;
    };
}
export declare function diffFileAliases(file: DiffFile | undefined): string[];
export declare function diffFileOperationPaths(file: DiffFile | undefined): string[];
export declare function createDiffSlice(scope: DiffScope, raw: string, files?: DiffFile[], capture?: {
    bytes: number;
    lines: number;
}): DiffSlice;
export declare function buildWorkingTreeDocument(input: WorkingTreeDocumentInput): WorkingTreeDocument;
export declare function emptyWorkingTreeDocument(title: string, subtitle: string, repositoryState?: RepositoryState, headState?: HeadState): WorkingTreeDocument;
export declare function buildCommitDocument(input: CommitDocumentInput): CommitDocument;
export declare function selectDiffSlice(document: DiffDocument, view?: WorkingTreeView): DiffSlice;
export declare function workingTreeHasConflicts(document: WorkingTreeDocument): boolean;
