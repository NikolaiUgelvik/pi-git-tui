import { BranchPickerController } from "./branch-picker-controller.js";
import type { HelpContext } from "./types.js";
import { DiffViewerActions } from "./viewer-actions.js";
export declare class DiffViewerBranchPicker extends DiffViewerActions {
    protected branchState: "closed" | "loading" | "open" | "create";
    protected branchPickerController: BranchPickerController;
    constructor(...args: ConstructorParameters<typeof DiffViewerActions>);
    protected isOperationLoading(): boolean;
    protected featureHelpContext(): HelpContext | undefined;
    protected hasFeatureOverlay(): boolean;
    protected renderFeatureOverlay(baseLines: string[], width: number): string[];
    protected handleFeatureOverlayInput(data: string): boolean;
    protected handleFeatureOpenInput(data: string): boolean;
    protected openBranchPicker(): Promise<void>;
    protected handleBranchInput(data: string): void;
    protected runBranchSwitch(name: string): Promise<void>;
    protected runBranchCreate(name: string): Promise<void>;
    private runBranchOperation;
    private reconcileBranchFailure;
    private executeBranchOperation;
    protected renderBranchOverlay(baseLines: string[], width: number): string[];
}
