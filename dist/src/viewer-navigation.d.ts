import type { DiffFile } from "./types.js";
import { DiffViewerCore, type SelectionPolicy } from "./viewer-core.js";
export declare class DiffViewerNavigation extends DiffViewerCore {
    protected handleViewerNavigationInput(data: string): boolean;
    protected handleFocusToggle(data: string): boolean;
    protected handleStageAllInput(data: string): boolean;
    protected handleFileStageToggle(data: string): boolean;
    protected handleFileStep(data: string): boolean;
    protected handleArrowScroll(data: string): boolean;
    protected arrowScrollDelta(data: string): number;
    protected handlePageScroll(data: string): boolean;
    protected handleEdgeJump(data: string): boolean;
    protected jumpToEdge(edge: "first" | "last"): void;
    protected refreshWorkingTreeAfterMutationFailure(cwd: string, operationSignal: AbortSignal, selection?: SelectionPolicy): Promise<"applied" | "superseded">;
    private executeStageMutation;
    protected toggleSelectedFileStage(file: DiffFile): Promise<void>;
    protected stageAllVisibleChanges(): Promise<void>;
}
