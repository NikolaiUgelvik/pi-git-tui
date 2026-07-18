import { type WorktreeSummary } from "./git-extras.js";
import { DiffViewerStashPicker } from "./viewer-stash-picker.js";
import { WorktreePickerController } from "./worktree-picker-controller.js";
export declare class DiffViewerWorktreePicker extends DiffViewerStashPicker {
    protected worktreePickerController: WorktreePickerController;
    protected worktreeState: "closed" | "loading" | "open";
    private worktreeRequest;
    constructor(...args: ConstructorParameters<typeof DiffViewerStashPicker>);
    protected openWorktreePicker(): Promise<void>;
    protected handleWorktreeInput(data: string): void;
    protected switchToWorktree(worktree: WorktreeSummary): Promise<void>;
    protected renderWorktreeOverlay(baseLines: string[], width: number): string[];
}
