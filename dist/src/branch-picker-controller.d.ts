import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import { SingleLineTextField } from "./single-line-text-field.js";
import type { BranchSummary } from "./types.js";
/** Callbacks the viewer provides to the controller for side effects. */
export interface BranchPickerCallbacks {
    onSwitch: (name: string) => void;
    onCreate: (name: string) => void;
    onValidationError: (message: string) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class BranchPickerController {
    list: FilterableListState<BranchSummary>;
    state: "closed" | "loading" | "open" | "create";
    loadingMessage: string | undefined;
    private readonly branchCreateField;
    private readonly _callbacks;
    constructor(callbacks: BranchPickerCallbacks);
    get branchCreateName(): string;
    set branchCreateName(value: string);
    activeTextField(): SingleLineTextField | undefined;
    open(branches: BranchSummary[]): void;
    close(): void;
    isOpen(): boolean;
    handleInput(data: string): void;
    private updatePickerInput;
    private openCreateMode;
    private updateCreateInput;
    private submitCreateInput;
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * Matches the existing branch picker rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private renderBodyRows;
    private renderSearchLine;
    private renderBranchItems;
    private renderBranchRow;
}
