import { DiffSettingsController } from "./diff-settings-controller.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { DiffViewerTagPicker } from "./viewer-tag-picker.js";
export class DiffViewerSettings extends DiffViewerTagPicker {
    diffSettingsController;
    constructor(...args) {
        super(...args);
        this.diffSettingsController = new DiffSettingsController({
            settingsListTheme: this.settingsListTheme,
            onRequestRender: () => this.requestRender(),
            onSave: (settings) => this.persistPluginSettings(settings),
            onSaved: (settings) => {
                this.applyPluginSettings(settings);
                this.error = undefined;
                this.errorDetails = undefined;
                this.statusMessage = "Settings saved";
            },
            theme: this.theme,
        });
        this.featureOverlays.register("settings", {
            isActive: () => this.diffSettingsController.isActive(),
            activeTextField: () => undefined,
            helpContext: () => "settings",
            render: (baseLines, width) => this.renderSettingsOverlay(baseLines, width),
            handleInput: (data) => this.diffSettingsController.handleInput(data),
            handleOpen: (data) => {
                if (data !== "S")
                    return false;
                if (this.canStartForegroundOperation("opening settings")) {
                    this.diffSettingsController.open(this.pluginSettings);
                }
                return true;
            },
            close: () => this.diffSettingsController.close(),
        });
    }
    invalidateDiffPresentation() {
        super.invalidateDiffPresentation();
        this.diffSettingsController.invalidate();
    }
    renderSettingsOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const frame = createOverlayFrame(baseLines.length, width, this.theme);
        const overlay = renderOverlayFrame(frame, ` ${this.theme.fg("accent", this.theme.bold("Pi Git TUI settings"))}`, ` ${this.theme.fg("dim", this.diffSettingsController.hint())}`, this.diffSettingsController.renderRows(frame.innerWidth));
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-settings.js.map