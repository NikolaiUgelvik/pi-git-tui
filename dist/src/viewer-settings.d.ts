import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export declare class DiffViewerSettings extends DiffViewerWorktreePicker {
    private readonly diffSettingsController;
    constructor(...args: ConstructorParameters<typeof DiffViewerWorktreePicker>);
    protected invalidateDiffPresentation(): void;
    private renderSettingsOverlay;
}
