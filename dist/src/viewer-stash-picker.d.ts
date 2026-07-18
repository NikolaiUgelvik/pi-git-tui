import { StashPickerController } from "./stash-picker-controller.js";
import type { HelpContext } from "./types.js";
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js";
export declare class DiffViewerStashPicker extends DiffViewerBranchPicker {
    protected stashState: "closed" | "loading" | "open" | "confirm";
    protected stashPickerController: StashPickerController;
    constructor(...args: ConstructorParameters<typeof DiffViewerBranchPicker>);
    protected isOperationLoading(): boolean;
    protected featureHelpContext(): HelpContext | undefined;
    protected hasFeatureOverlay(): boolean;
    protected renderFeatureOverlay(baseLines: string[], width: number): string[];
    protected handleFeatureOverlayInput(data: string): boolean;
    protected handleFeatureOpenInput(data: string): boolean;
    protected openStashPicker(): Promise<void>;
    protected handleStashInput(data: string): void;
    protected runStashCurrent(): Promise<void>;
    protected runStashApply(ref: string): Promise<void>;
    protected runStashPop(ref: string): Promise<void>;
    protected runStashDrop(ref: string): Promise<void>;
    protected runStashOperation(label: string, operation: (cwd: string, signal: AbortSignal) => Promise<string>, afterSuccess: (cwd: string, signal: AbortSignal) => Promise<void>): Promise<void>;
    protected refreshWorkingTreeAfterStashFailure(cwd: string, operationSignal: AbortSignal): Promise<void>;
    protected renderStashOverlay(baseLines: string[], width: number): string[];
}
