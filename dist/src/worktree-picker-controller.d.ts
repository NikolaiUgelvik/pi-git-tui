import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import type { WorktreeSummary } from "./types.js";
/** Callbacks the viewer provides to the controller for side effects. */
export interface WorktreePickerCallbacks {
    onSwitch: (worktree: WorktreeSummary) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class WorktreePickerController {
    list: FilterableListState<WorktreeSummary>;
    state: "closed" | "loading" | "open";
    loadingMessage: string | undefined;
    activePath: string;
    private readonly _callbacks;
    constructor(callbacks: WorktreePickerCallbacks);
    open(worktrees: WorktreeSummary[], activePath: string): void;
    close(): void;
    isOpen(): boolean;
    handleInput(data: string): void;
    private searchText;
    refLabel(worktree: WorktreeSummary): string;
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private renderBodyRows;
    private renderSearchLine;
    private renderWorktreeItems;
    private renderWorktreeRow;
}
