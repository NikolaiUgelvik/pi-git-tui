import { type WorktreeSummary } from "./git-extras.js";
import type { HelpContext } from "./types.js";
import { DiffViewerStashPicker } from "./viewer-stash-picker.js";
import { WorktreePickerController } from "./worktree-picker-controller.js";
export declare class DiffViewerWorktreePicker extends DiffViewerStashPicker {
    protected worktreeState: "closed" | "loading" | "open";
    protected worktreePickerController: WorktreePickerController;
    constructor(...args: ConstructorParameters<typeof DiffViewerStashPicker>);
    protected isOperationLoading(): boolean;
    protected featureHelpContext(): HelpContext | undefined;
    protected hasFeatureOverlay(): boolean;
    protected renderFeatureOverlay(baseLines: string[], width: number): string[];
    protected handleFeatureOverlayInput(data: string): boolean;
    protected handleFeatureOpenInput(data: string): boolean;
    protected openWorktreePicker(): Promise<void>;
    protected handleWorktreeInput(data: string): void;
    protected switchToWorktree(worktree: WorktreeSummary): Promise<void>;
    protected renderWorktreeOverlay(baseLines: string[], width: number): string[];
}
