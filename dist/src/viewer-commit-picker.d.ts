import { CommitPickerController } from "./commit-picker-controller.js";
import type { SingleLineTextField } from "./single-line-text-field.js";
import type { CommitSummary } from "./types.js";
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js";
export declare class DiffViewerCommitPicker extends DiffViewerOverlayBase {
    protected commitPickerController: CommitPickerController;
    private commitPickerRequest;
    constructor(...args: ConstructorParameters<typeof DiffViewerOverlayBase>);
    protected activeTextField(): SingleLineTextField | undefined;
    protected openCommitPicker(): Promise<void>;
    protected handleCommitPickerInput(data: string): void;
    protected returnToWorkingTree(): Promise<void>;
    protected selectWorkingTree(): Promise<void>;
    protected selectCommit(commit: CommitSummary): Promise<void>;
    private selectDocument;
    protected renderCommitPickerOverlay(baseLines: string[], width: number): string[];
    protected isBackspace(data: string): boolean;
}
