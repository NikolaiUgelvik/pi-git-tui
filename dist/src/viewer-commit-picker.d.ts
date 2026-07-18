import { CommitPickerController } from "./commit-picker-controller.js";
import type { CommitSummary } from "./types.js";
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js";
export declare class DiffViewerCommitPicker extends DiffViewerOverlayBase {
    protected commitPickerController: CommitPickerController;
    constructor(...args: ConstructorParameters<typeof DiffViewerOverlayBase>);
    protected openCommitPicker(): Promise<void>;
    protected handleCommitPickerInput(data: string): void;
    protected selectWorkingTree(): Promise<void>;
    protected selectCommit(commit: CommitSummary): Promise<void>;
    protected renderCommitPickerOverlay(baseLines: string[], width: number): string[];
    protected isBackspace(data: string): boolean;
}
