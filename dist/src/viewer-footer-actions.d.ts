import type { DiffDocument, FocusPanel, WorkingTreeView } from "./types.js";
export interface ViewerFooterContext {
    document: DiffDocument;
    focusedPanel: FocusPanel;
    workingTreeView: WorkingTreeView;
    totals: string;
}
export declare function prioritizedFooter(summary: string, controls: string[], width: number): string;
export declare function viewerFooterActions(context: ViewerFooterContext, width: number): string[];
