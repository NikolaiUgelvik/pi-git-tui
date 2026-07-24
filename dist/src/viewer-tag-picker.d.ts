import { TagPickerController, type TagPickerState } from "./tag-picker-controller.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export declare class DiffViewerTagPicker extends DiffViewerWorktreePicker {
    protected tagPickerController: TagPickerController;
    constructor(...args: ConstructorParameters<typeof DiffViewerWorktreePicker>);
    protected get tagState(): TagPickerState;
    protected handleTagInput(data: string): void;
    private cancelTagOperation;
    private loadTagList;
    private loadTagTargets;
    private viewTag;
    private runTagCreate;
    private tagListRefreshIntent;
    protected renderTagOverlay(baseLines: string[], width: number): string[];
}
