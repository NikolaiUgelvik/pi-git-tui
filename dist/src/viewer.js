import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { fit } from "./render-text.js";
import { HELP_TITLES, helpActionsForDocument } from "./viewer-help.js";
import { DiffViewerSettings } from "./viewer-settings.js";
export class DiffViewer extends DiffViewerSettings {
    activeFocusedField;
    viewerFocused = false;
    get focused() {
        return this.viewerFocused;
    }
    set focused(value) {
        this.viewerFocused = value;
        this.syncTextFieldFocus();
    }
    render(width) {
        this.syncTextFieldFocus();
        return super.render(width);
    }
    syncTextFieldFocus() {
        const field = this.activeTextField();
        if (this.activeFocusedField !== field) {
            if (this.activeFocusedField) {
                this.activeFocusedField.focused = false;
            }
            this.activeFocusedField = field;
        }
        if (field) {
            field.focused = this.viewerFocused;
        }
    }
    renderOverlays(baseLines, width) {
        const renderedLines = this.renderActiveOverlay(baseLines, width);
        if (this.helpContext === undefined) {
            return renderedLines;
        }
        return this.renderHelpOverlay(renderedLines, width);
    }
    renderActiveOverlay(baseLines, width) {
        if (this.hasFeatureOverlay()) {
            return this.renderFeatureOverlay(baseLines, width);
        }
        if (this.commitDialogState !== "closed") {
            return this.renderCommitDialogOverlay(baseLines, width);
        }
        if (this.commandMenuState !== "closed") {
            return this.renderCommandMenuOverlay(baseLines, width);
        }
        if (this.pickerState !== "closed") {
            return this.renderCommitPickerOverlay(baseLines, width);
        }
        return baseLines.map((line) => fit(line, width));
    }
    renderHelpOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const frame = createOverlayFrame(baseLines.length, width, this.theme);
        const overlay = this.helpOverlayLines(frame);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
    helpOverlayLines(frame) {
        const context = this.helpContext ?? "viewer";
        const rows = this.helpActions(context).flatMap((action) => this.renderHelpActionRows(action, frame.innerWidth));
        this.helpOverlayState.configure(context, rows.length, frame.bodyRows);
        const range = this.helpOverlayState.visibleRange();
        const hint = frame.compact
            ? `Esc close • ↑↓ ${this.helpOverlayState.rangeLabel()}`
            : `↑↓/PgUp/PgDn/Home/End scroll • ${this.helpOverlayState.rangeLabel()} • F1/?/Esc/q close`;
        return renderOverlayFrame(frame, ` ${this.theme.fg("accent", this.theme.bold(this.helpTitle(context)))}`, ` ${this.theme.fg("dim", hint)}`, rows.slice(range.start, range.end));
    }
    currentHelpContext() {
        return this.featureHelpContext() ?? super.currentHelpContext();
    }
    helpTitle(context) {
        return HELP_TITLES[context];
    }
    helpActions(context) {
        return helpActionsForDocument(context, this.document);
    }
    renderHelpActionRows(action, width) {
        const contentWidth = Math.max(1, width - 1);
        if (!action.keys) {
            return wrapTextWithAnsi(action.action, contentWidth).map((row) => ` ${this.theme.fg("muted", row)}`);
        }
        const keyWidth = Math.min(14, Math.max(6, Math.floor(contentWidth * 0.35)));
        const descriptionWidth = Math.max(1, contentWidth - keyWidth - 1);
        const keyRows = wrapTextWithAnsi(action.keys, keyWidth);
        const descriptionRows = wrapTextWithAnsi(action.action, descriptionWidth);
        const rowCount = Math.max(keyRows.length, descriptionRows.length);
        return Array.from({ length: rowCount }, (_value, index) => {
            const key = fit(keyRows[index] ?? "", keyWidth);
            return ` ${this.theme.fg("accent", key)} ${descriptionRows[index] ?? ""}`;
        });
    }
    handleInput(data) {
        if (this.helpContext !== undefined) {
            this.handleHelpInput(data);
            return;
        }
        if (this.handleHelpInput(data, false)) {
            return;
        }
        if (data === "?" && this.activeTextField() === undefined && this.handleHelpInput(data)) {
            return;
        }
        const handlers = [
            () => this.handleFeatureOverlayInput(data),
            () => this.handleActiveOverlayInput(data),
            () => this.handleOperationCancelInput(data),
            () => this.handleCloseInput(data),
            () => this.handleFeatureOpenInput(data),
            () => this.handleOpenOverlayInput(data),
        ];
        if (!handlers.some((handle) => handle())) {
            this.handleViewerNavigationInput(data);
            this.requestRender();
        }
    }
    invalidate() {
        this.invalidateDiffPresentation();
        this.activeTextField()?.invalidate();
    }
}
//# sourceMappingURL=viewer.js.map