import { fit } from "./render-text.js";
import { HELP_ACTIONS, HELP_TITLES } from "./viewer-help.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export class DiffViewer extends DiffViewerWorktreePicker {
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
        const overlay = this.helpOverlayLines(layout.overlayWidth);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
    helpOverlayLines(overlayWidth) {
        const row = (content) => this.commitPickerOverlayRow(content, overlayWidth);
        const context = this.helpContext ?? "viewer";
        return [
            this.commitPickerBorder("top", overlayWidth),
            row(` ${this.theme.fg("accent", this.theme.bold(this.helpTitle(context)))}`),
            row(` ${this.theme.fg("dim", "press ? / esc / q to close help")}`),
            row(""),
            ...this.helpActions(context).map((action) => row(this.renderHelpAction(action))),
            row(""),
            this.commitPickerBorder("bottom", overlayWidth),
        ];
    }
    currentHelpContext() {
        return this.featureHelpContext() ?? super.currentHelpContext();
    }
    helpTitle(context) {
        return HELP_TITLES[context];
    }
    helpActions(context) {
        return HELP_ACTIONS[context];
    }
    renderHelpAction(action) {
        if (!action.keys) {
            return ` ${this.theme.fg("muted", action.action)}`;
        }
        return ` ${this.theme.fg("accent", fit(action.keys, 14))} ${action.action}`;
    }
    handleInput(data) {
        if (this.isOperationLoading() && this.handleCloseInput(data)) {
            return;
        }
        if (this.handleHelpInput(data)) {
            return;
        }
        if (this.mutationActive() && this.handleViewerNavigationInput(data)) {
            this.requestRender();
            return;
        }
        if (this.handleFeatureOverlayInput(data) ||
            this.handleActiveOverlayInput(data) ||
            this.handleCloseInput(data) ||
            this.handleFeatureOpenInput(data) ||
            this.handleOpenOverlayInput(data)) {
            return;
        }
        this.handleViewerNavigationInput(data);
        this.requestRender();
    }
    invalidate() {
        this.invalidateRenderCache();
    }
}
//# sourceMappingURL=viewer.js.map