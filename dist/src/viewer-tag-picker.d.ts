import { TagPickerController, type TagPickerState } from "./tag-picker-controller.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export declare class DiffViewerTagPicker extends DiffViewerWorktreePicker {
    protected tagPickerController: TagPickerController;
    private tagRequest;
    private tagLoadingReturnState;
    constructor(...args: ConstructorParameters<typeof DiffViewerWorktreePicker>);
    protected get tagState(): TagPickerState;
    protected handleTagInput(data: string): void;
    private cancelTagOperation;
    private loadTagList;
    private loadTagTargets;
    private viewTag;
    private runTagCreate;
    private tagListRefreshIntent;
    private beginTagLoading;
    private finishTagLoading;
    protected renderTagOverlay(baseLines: string[], width: number): string[];
}
