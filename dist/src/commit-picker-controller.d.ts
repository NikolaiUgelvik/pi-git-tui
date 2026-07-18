import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import type { CommitPickerItem, CommitSummary } from "./types.js";
/** Callbacks the viewer provides to the controller for side effects. */
export interface CommitPickerCallbacks {
    onSelectWorkingTree: () => void;
    onSelectCommit: (commit: CommitSummary) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class CommitPickerController {
    list: FilterableListState<CommitPickerItem>;
    state: "closed" | "loading" | "open";
    loadingMessage: string | undefined;
    totalCommits: number;
    private readonly _callbacks;
    constructor(callbacks: CommitPickerCallbacks);
    open(commits: CommitSummary[]): void;
    close(): void;
    isOpen(): boolean;
    handleInput(data: string): void;
    private handleSelection;
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * Matches the existing commit picker rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private renderSearchLine;
    private getFilteredCommitCount;
    private renderBodyRows;
    private renderItemRow;
}
