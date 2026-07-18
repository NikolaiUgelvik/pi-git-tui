import { type FailureDetails } from "./failure-details.js";
import type { CommitSummary, DiffDocument, DiffFile, DiffSlice, WorkingTreeView } from "./types.js";
export type DiffLoadRequest = {
    kind: "working";
    cwd: string;
} | {
    kind: "commit";
    cwd: string;
    commit: CommitSummary;
};
export interface DocumentSelection {
    preferredPath?: string;
    aliases: string[];
    status?: DiffFile["status"];
    stageState?: DiffFile["stageState"];
    untracked?: boolean;
}
export interface DocumentLoadFailure extends FailureDetails {
    request: DiffLoadRequest;
}
export type ViewerInitialDocument = {
    status: "loaded";
    document: DiffDocument;
    request?: DiffLoadRequest;
} | {
    status: "failed";
    request: DiffLoadRequest;
    failure: DocumentLoadFailure;
};
export declare function loadedViewerDocument(document: DiffDocument, request?: DiffLoadRequest): ViewerInitialDocument;
export declare function failedViewerDocument(request: DiffLoadRequest, error: unknown): ViewerInitialDocument;
export declare class ViewerDocumentState {
    private _activeCwd;
    private _diffColumn;
    private _diffScroll;
    private _document;
    private _failedTarget;
    private _failure;
    private _generation;
    private _reloadRequest;
    private _request;
    private _selectedFileIndex;
    private _workingTreeView;
    constructor(initialCwd: string, initial: DiffDocument | ViewerInitialDocument);
    get activeCwd(): string;
    get diffColumn(): number;
    set diffColumn(value: number);
    get diffScroll(): number;
    set diffScroll(value: number);
    get document(): DiffDocument;
    get failedTarget(): DocumentLoadFailure | undefined;
    get failure(): DocumentLoadFailure | undefined;
    get files(): DiffFile[];
    get generation(): number;
    get reloadRequest(): DiffLoadRequest;
    get request(): DiffLoadRequest;
    get selectedFileIndex(): number;
    set selectedFileIndex(value: number);
    get slice(): DiffSlice;
    get workingTreeView(): WorkingTreeView;
    captureSelection(preferredPath?: string): DocumentSelection;
    replaceDocument(request: DiffLoadRequest, document: DiffDocument, selection?: DocumentSelection): void;
    updateMetadata(document: DiffDocument): void;
    recordLoadFailure(request: DiffLoadRequest, error: unknown): DocumentLoadFailure;
    abandonFailedTarget(): boolean;
    setWorkingTreeView(view: WorkingTreeView): boolean;
    private selectionIndex;
}
