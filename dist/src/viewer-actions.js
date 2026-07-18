import { matchesKey } from "@earendil-works/pi-tui";
import { loadWorkingTreeDiff } from "./git.js";
import { discardFileChanges, initializeGitRepository } from "./git-extras.js";
import { DiffViewerCommandMenu } from "./viewer-command-menu.js";
export class DiffViewerActions extends DiffViewerCommandMenu {
    confirmState = "closed";
    confirmAction;
    confirmFile;
    isOperationLoading() {
        return this.confirmState === "loading" || super.isOperationLoading();
    }
    featureHelpContext() {
        return this.confirmState !== "closed" ? "confirmDialog" : undefined;
    }
    hasFeatureOverlay() {
        return this.confirmState !== "closed";
    }
    renderFeatureOverlay(baseLines, width) {
        return this.renderConfirmOverlay(baseLines, width);
    }
    handleFeatureOverlayInput(data) {
        if (this.confirmState === "closed") {
            return false;
        }
        this.handleConfirmInput(data);
        return true;
    }
    handleFeatureOpenInput(data) {
        return this.handleOpenInitDialogInput(data) || this.handleOpenDiscardDialogInput(data);
    }
    handleOpenInitDialogInput(data) {
        if (data !== "I") {
            return false;
        }
        if (this.mutationActive()) {
            return true;
        }
        if (this.document.repositoryState !== "missing") {
            return true;
        }
        this.error = undefined;
        this.statusMessage = undefined;
        this.confirmAction = "init";
        this.confirmFile = undefined;
        this.confirmState = "open";
        this.requestRender();
        return true;
    }
    handleOpenDiscardDialogInput(data) {
        if (data !== "D") {
            return false;
        }
        if (this.mutationActive()) {
            return true;
        }
        if (this.document.mode !== "working") {
            this.error = "Discard is only available in the working tree";
            this.statusMessage = undefined;
            this.requestRender();
            return true;
        }
        const file = this.document.files[this.selectedFileIndex];
        if (!file) {
            return true;
        }
        if (file.omission) {
            this.error = `Cannot discard ${file.path} because its diff was omitted`;
            this.statusMessage = undefined;
            this.requestRender();
            return true;
        }
        if (file.submodule?.startsWith("S")) {
            this.error = `Cannot discard ${file.path}: manage nested changes inside the submodule`;
            this.statusMessage = undefined;
            this.requestRender();
            return true;
        }
        this.error = undefined;
        this.statusMessage = undefined;
        this.confirmAction = "discard";
        this.confirmFile = file;
        this.confirmState = "open";
        this.requestRender();
        return true;
    }
    handleConfirmInput(data) {
        if (this.confirmState === "loading") {
            return;
        }
        if (this.isConfirmCancel(data)) {
            this.closeConfirmDialog();
            return;
        }
        if (this.isEnter(data)) {
            this.runConfirmedAction().catch((error) => this.showAsyncError(error));
        }
    }
    isConfirmCancel(data) {
        return matchesKey(data, "escape") || this.isKey(data, "q");
    }
    closeConfirmDialog() {
        this.confirmState = "closed";
        this.confirmAction = undefined;
        this.confirmFile = undefined;
        this.requestRender();
    }
    async runConfirmedAction() {
        const action = this.confirmAction;
        const kind = action === "init" ? "initialize" : "discard";
        await this.runMutation(kind, (signal) => this.executeConfirmedMutation(action, signal));
    }
    confirmedSelection(action) {
        return action === "init" ? "first" : "preserve-current-path";
    }
    completeConfirmedMutation(message) {
        this.statusMessage = message;
        this.confirmState = "closed";
        this.confirmAction = undefined;
        this.confirmFile = undefined;
    }
    async reconcileConfirmedFailure(cwd, signal, action) {
        const disposition = await this.refreshWorkingTreeAfterMutationFailure(cwd, signal, this.confirmedSelection(action));
        if (disposition === "applied")
            this.confirmState = "open";
        return disposition;
    }
    async executeConfirmedMutation(action, signal) {
        const cwd = this.activePath();
        let disposition;
        this.confirmState = "loading";
        this.loadingMessage = this.confirmLoadingMessage();
        this.error = undefined;
        this.statusMessage = undefined;
        this.requestRender();
        try {
            const message = await this.executeConfirmedAction(action, cwd, signal);
            disposition = await this.loadLatestDocument({
                cwd,
                target: `working:${cwd}`,
                selection: this.confirmedSelection(action),
                load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
                operationSignal: signal,
            });
            if (disposition === "applied")
                this.completeConfirmedMutation(message);
        }
        catch (error) {
            if (this.setAsyncError(error))
                disposition = await this.reconcileConfirmedFailure(cwd, signal, action);
        }
        finally {
            if (disposition !== "superseded") {
                this.loadingMessage = undefined;
                this.requestRender();
            }
        }
    }
    executeConfirmedAction(action, cwd, signal) {
        if (action === "init") {
            return initializeGitRepository(this.pi, cwd, signal);
        }
        if (action === "discard" && this.confirmFile) {
            return discardFileChanges(this.pi, cwd, this.confirmFile, signal);
        }
        return Promise.reject(new Error("No confirmed action selected"));
    }
    confirmLoadingMessage() {
        return this.confirmAction === "init"
            ? "Initializing git repository…"
            : `Discarding ${this.confirmFile?.path ?? "file"}…`;
    }
    renderConfirmOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const row = (content) => this.commitPickerOverlayRow(content, layout.overlayWidth);
        const overlay = [
            this.commitPickerBorder("top", layout.overlayWidth),
            row(` ${this.theme.fg("accent", this.theme.bold(this.confirmTitle()))}`),
            row(` ${this.theme.fg("dim", "Enter OK • Esc/q Cancel • ? help")}`),
            row(""),
            ...this.confirmBodyRows(row),
            row(""),
            this.commitPickerBorder("bottom", layout.overlayWidth),
        ];
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
    confirmTitle() {
        if (this.confirmState === "loading") {
            return this.loadingMessage ?? "Working…";
        }
        return this.confirmAction === "init" ? "Initialize git repository" : "Discard selected file changes";
    }
    confirmBodyRows(row) {
        if (this.confirmState === "loading") {
            return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`)];
        }
        if (this.confirmAction === "init") {
            return [row(` Initialize git repo in ${this.activePath()}?`), row(""), row(" [ OK ]   [ Cancel ]")];
        }
        return [
            row(` Discard all staged and unstaged changes for ${this.confirmFile?.path ?? "file"}?`),
            row(this.theme.fg("warning", " This cannot be undone.")),
            row(""),
            row(" [ OK ]   [ Cancel ]"),
        ];
    }
}
//# sourceMappingURL=viewer-actions.js.map