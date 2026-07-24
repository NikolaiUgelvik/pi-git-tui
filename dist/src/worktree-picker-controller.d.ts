import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import { type PickerRequest } from "./picker-session.js";
import type { WorktreeSummary } from "./types.js";
/** Callbacks the viewer provides to the controller for side effects. */
export interface WorktreePickerCallbacks {
    onSwitch: (worktree: WorktreeSummary) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class WorktreePickerController {
    list: FilterableListState<WorktreeSummary>;
    activePath: string;
    private readonly session;
    private readonly _callbacks;
    constructor(callbacks: WorktreePickerCallbacks);
    get state(): "closed" | "loading" | "open";
    get loadingMessage(): string | undefined;
    beginLoading(message: string, returnState: "closed" | "open"): PickerRequest;
    isCurrent(request: PickerRequest): boolean;
    finishLoading(request: PickerRequest, nextState: "closed" | "open"): boolean;
    cancelLoading(): "closed" | "open";
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
