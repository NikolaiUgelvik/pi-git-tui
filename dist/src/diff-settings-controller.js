import { matchesKey, SettingsList, wrapTextWithAnsi, } from "@earendil-works/pi-tui";
import { copyPluginSettings } from "./plugin-settings.js";
export class DiffSettingsController {
    options;
    draft;
    error;
    list;
    state = "closed";
    constructor(options) {
        this.options = options;
    }
    isActive() {
        return this.state !== "closed";
    }
    open(settings) {
        this.draft = copyPluginSettings(settings);
        this.error = undefined;
        this.state = "open";
        this.list = this.createList();
        this.options.onRequestRender();
    }
    close() {
        if (this.state === "saving")
            return;
        this.state = "closed";
        this.error = undefined;
        this.list = undefined;
        this.options.onRequestRender();
    }
    handleInput(data) {
        if (this.state === "saving")
            return;
        if (matchesKey(data, "ctrl+s")) {
            void this.save();
            return;
        }
        this.list?.handleInput(data);
        this.options.onRequestRender();
    }
    hint() {
        return this.state === "saving" ? "Saving…" : "Enter/Space: Change • Ctrl+S: Save • Esc: Cancel • F1: Help";
    }
    renderRows(width) {
        const rows = this.list?.render(width) ?? [];
        if (this.state === "saving") {
            return [this.options.theme.fg("warning", "  Saving settings…"), "", ...rows];
        }
        if (!this.error)
            return rows;
        const errorRows = wrapTextWithAnsi(`Could not save settings: ${this.error}`, Math.max(1, width - 4)).map((row) => this.options.theme.fg("warning", `  ${row}`));
        return [...errorRows, "", ...rows];
    }
    invalidate() {
        if (this.isActive())
            this.list = this.createList();
    }
    createList() {
        const items = [
            {
                id: "diff-wrap",
                label: "Wrap diff lines",
                description: "Wrap long diff lines to the panel width instead of scrolling horizontally",
                currentValue: this.draft.diff.wrap ? "on" : "off",
                values: ["on", "off"],
            },
        ];
        return new SettingsList(items, items.length, this.options.settingsListTheme(), (id, value) => {
            if (id === "diff-wrap")
                this.draft = { diff: { wrap: value === "on" } };
            this.error = undefined;
            this.options.onRequestRender();
        }, () => this.close());
    }
    async save() {
        const settings = copyPluginSettings(this.draft);
        this.error = undefined;
        this.state = "saving";
        this.options.onRequestRender();
        try {
            await this.options.onSave(settings);
            this.options.onSaved(settings);
            this.state = "open";
            this.close();
        }
        catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.state = "open";
            this.options.onRequestRender();
        }
    }
}
//# sourceMappingURL=diff-settings-controller.js.map