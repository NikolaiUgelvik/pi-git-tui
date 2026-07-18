import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import { type ForcePushPreview, type GitCommand } from "./types.js";
export interface CommandMenuCallbacks {
    onRunCommand: (command: GitCommand) => void;
    onPreviewForcePush: (command: GitCommand) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class CommandMenuController {
    private readonly callbacks;
    list: FilterableListState<GitCommand>;
    state: "closed" | "loading" | "open" | "confirm";
    loadingMessage: string | undefined;
    previewError: string | undefined;
    pendingCommand: GitCommand | undefined;
    forcePushPreview: ForcePushPreview | undefined;
    constructor(callbacks: CommandMenuCallbacks);
    open(): void;
    close(): void;
    isOpen(): boolean;
    showForcePushConfirmation(command: GitCommand, preview: ForcePushPreview): void;
    showPreviewFailure(message: string): void;
    returnToMenu(): void;
    handleInput(data: string): void;
    private selectCommand;
    private handleConfirmationInput;
    private clearPendingPreview;
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private renderForcePushConfirmation;
    private compactForcePushBody;
    private compactRef;
    private forcePushConfirmationPrompt;
    private renderSearchLine;
    private renderBodyRows;
    private renderCommandRow;
}
