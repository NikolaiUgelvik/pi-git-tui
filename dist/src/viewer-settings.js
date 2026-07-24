import { DiffSettingsController } from "./diff-settings-controller.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
export function createSettingsFeature(options) {
    const controller = new DiffSettingsController({
        settingsListTheme: options.settingsListTheme,
        onRequestRender: options.requestRender,
        onSave: options.save,
        onSaved: options.saved,
        theme: options.theme,
    });
    return {
        kind: "settings",
        adapter: {
            isActive: () => controller.isActive(),
            activeTextField: () => undefined,
            helpContext: () => "settings",
            render: (baseLines, width) => options.renderPicker(baseLines, width, (baseLineCount, overlayWidth) => {
                const frame = createOverlayFrame(baseLineCount, overlayWidth, options.theme);
                return renderOverlayFrame(frame, ` ${options.theme.fg("accent", options.theme.bold("Pi Git TUI settings"))}`, ` ${options.theme.fg("dim", controller.hint())}`, controller.renderRows(frame.innerWidth));
            }),
            handleInput: (data) => controller.handleInput(data),
            handleOpen: (data) => {
                if (data !== "S")
                    return false;
                if (options.canOpen())
                    controller.open(options.currentSettings());
                return true;
            },
            close: () => controller.close(),
        },
        invalidate: () => controller.invalidate(),
    };
}
//# sourceMappingURL=viewer-settings.js.map