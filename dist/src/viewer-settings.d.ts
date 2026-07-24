import { DiffViewerTagPicker } from "./viewer-tag-picker.js";
export declare class DiffViewerSettings extends DiffViewerTagPicker {
    private readonly diffSettingsController;
    constructor(...args: ConstructorParameters<typeof DiffViewerTagPicker>);
    protected invalidateDiffPresentation(): void;
    private renderSettingsOverlay;
}
