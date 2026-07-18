import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import type { GitCommand } from "./types.js";
/** Callbacks the viewer provides to the controller for side effects. */
export interface CommandMenuCallbacks {
    onRunCommand: (command: GitCommand) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class CommandMenuController {
    private readonly callbacks;
    list: FilterableListState<GitCommand>;
    state: "closed" | "loading" | "open";
    loadingMessage: string | undefined;
    constructor(callbacks: CommandMenuCallbacks);
    open(): void;
    close(): void;
    isOpen(): boolean;
    handleInput(data: string): void;
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * This matches the existing rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private renderSearchLine;
    private renderBodyRows;
    private renderCommandRow;
}
