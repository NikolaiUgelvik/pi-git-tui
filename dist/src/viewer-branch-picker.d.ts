import { BranchPickerController } from "./branch-picker-controller.js";
import { DiffViewerActions } from "./viewer-actions.js";
export declare class DiffViewerBranchPicker extends DiffViewerActions {
    protected branchPickerController: BranchPickerController;
    protected branchState: "closed" | "loading" | "open" | "create";
    private branchRequest;
    constructor(...args: ConstructorParameters<typeof DiffViewerActions>);
    protected openBranchPicker(): Promise<void>;
    protected handleBranchInput(data: string): void;
    protected runBranchSwitch(name: string): Promise<void>;
    protected runBranchCreate(name: string): Promise<void>;
    private runBranchOperation;
    protected renderBranchOverlay(baseLines: string[], width: number): string[];
}
