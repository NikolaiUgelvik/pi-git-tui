import { StashPickerController } from "./stash-picker-controller.js";
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js";
import type { MutationOutcome } from "./viewer-operation-coordinator.js";
export declare class DiffViewerStashPicker extends DiffViewerBranchPicker {
    protected stashPickerController: StashPickerController;
    protected stashState: "closed" | "loading" | "open" | "confirm";
    private stashListRequest;
    private stashMutationFeedback;
    constructor(...args: ConstructorParameters<typeof DiffViewerBranchPicker>);
    protected openStashPicker(): Promise<void>;
    protected handleStashInput(data: string): void;
    protected runStashCurrent(): Promise<void>;
    protected runStashApply(ref: string): Promise<void>;
    protected runStashPop(ref: string): Promise<void>;
    protected runStashDrop(ref: string): Promise<void>;
    protected runStashOperation(label: string, operation: (cwd: string, signal: AbortSignal) => Promise<string>): Promise<MutationOutcome<string>>;
    private retryStashList;
    private loadStashList;
    private beginStashListLoad;
    private applyStashList;
    private applyStashListOutcome;
    private finishStashListLoad;
    private restoreStashMutationFeedback;
    private closeStashAfterMutation;
    protected renderStashOverlay(baseLines: string[], width: number): string[];
}
