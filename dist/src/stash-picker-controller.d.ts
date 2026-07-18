import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import type { StashConfirm, StashSummary } from "./types.js";
export type StashAction = "stash-current" | "stash-item";
export type StashItem = {
    type: StashAction;
    stash?: StashSummary;
};
/** Callbacks the viewer provides to the controller for side effects. */
export interface StashPickerCallbacks {
    onStashCurrent: () => void;
    onApply: (ref: string) => void;
    onPop: (ref: string) => void;
    onDrop: (ref: string) => void;
    onRetryList: () => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class StashPickerController {
    list: FilterableListState<StashItem>;
    state: "closed" | "loading" | "open" | "confirm";
    loadingMessage: string | undefined;
    warning: string | undefined;
    stashConfirmAction: StashConfirm | undefined;
    stashConfirmItem: StashSummary | undefined;
    private readonly _callbacks;
    private _rawStashes;
    constructor(callbacks: StashPickerCallbacks);
    get stashConfirmRef(): string;
    clearStashConfirmation(): void;
    open(stashes: StashSummary[]): void;
    refreshStashes(stashes: StashSummary[]): void;
    showListWarning(message: string): void;
    close(): void;
    isOpen(): boolean;
    private rebuildItems;
    handleInput(data: string): void;
    private updatePickerInput;
    private handlePop;
    private handleDrop;
    private openConfirm;
    private handleConfirmInput;
    private handleSelection;
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private stashTitle;
    private stashHint;
    private renderBodyRows;
    private stashConfirmationPrompt;
    private renderSearchLine;
    private renderStashItems;
    private renderStashRow;
    private stashRowLine;
}
