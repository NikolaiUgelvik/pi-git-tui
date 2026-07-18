import { DiffViewerCommitPicker } from "./viewer-commit-picker.js";
export declare class DiffViewerCommitDialog extends DiffViewerCommitPicker {
    protected openCommitDialog(): void;
    protected handleCommitDialogInput(data: string): void;
    protected closeCommitDialogOnEscape(data: string): boolean;
    protected updateCommitDialogInput(data: string): void;
    protected commitMessageChars(): string[];
    protected commitMessageLength(): number;
    protected clampCommitMessageCaret(chars?: string[]): number;
    protected setCommitMessageChars(chars: string[]): void;
    protected handleCommitAmendToggle(data: string): boolean;
    protected handleCommitMessageGeneration(data: string): boolean;
    protected handleCommitMessageCaretMove(data: string): boolean;
    protected handleCommitMessageBackspace(data: string): boolean;
    protected handleCommitMessageDelete(data: string): boolean;
    protected handleCommitSubmission(data: string): boolean;
    protected handleCommitMessageText(data: string): boolean;
    protected generateCommitMessageIntoDialog(): Promise<void>;
    protected commitStagedChanges(message: string): Promise<void>;
    protected renderCommitDialogOverlay(baseLines: string[], width: number): string[];
    protected commitDialogOverlayLines(overlayWidth: number): string[];
    protected commitDialogTitle(): string;
    protected commitDialogBodyRows(row: (content: string) => string): string[];
    protected renderCommitMessageInput(): string;
}
