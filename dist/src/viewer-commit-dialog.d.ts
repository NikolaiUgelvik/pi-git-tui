import { type OverlayFrame } from "./overlay-frame.js";
import { SingleLineTextField } from "./single-line-text-field.js";
import { DiffViewerCommitPicker } from "./viewer-commit-picker.js";
export declare class DiffViewerCommitDialog extends DiffViewerCommitPicker {
    private commitDialogEpoch;
    protected readonly commitMessageField: SingleLineTextField;
    protected get commitMessage(): string;
    protected set commitMessage(value: string);
    protected activeTextField(): SingleLineTextField | undefined;
    protected openCommitDialog(): void;
    protected handleCommitDialogInput(data: string): void;
    protected closeCommitDialogOnEscape(data: string): boolean;
    protected updateCommitDialogInput(data: string): void;
    protected handleCommitAmendToggle(data: string): boolean;
    protected handleCommitMessageGeneration(data: string): boolean;
    protected handleCommitSubmission(data: string): boolean;
    protected generateCommitMessageIntoDialog(): Promise<void>;
    protected requestGeneratedCommitMessage(signal: AbortSignal): Promise<string>;
    protected commitStagedChanges(message: string): Promise<void>;
    protected commitUnavailableReason(amend: boolean): string | undefined;
    private clearCommittedDialog;
    protected renderCommitDialogOverlay(baseLines: string[], width: number): string[];
    protected commitDialogOverlayLines(frame: OverlayFrame): string[];
    protected commitDialogTitle(): string;
    protected commitDialogBodyRows(innerWidth: number): string[];
    protected stagedFileCount(): number;
    protected renderCommitMessageInput(width: number): string;
}
