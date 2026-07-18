import { loadWorkingTreeDiff } from "./git.js";
import { applyStash, dropStash, listStashes, popStash, stashCurrentChanges } from "./git-extras.js";
import { StashPickerController } from "./stash-picker-controller.js";
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js";
export class DiffViewerStashPicker extends DiffViewerBranchPicker {
    stashState = "closed";
    stashPickerController;
    constructor(...args) {
        super(...args);
        this.stashPickerController = new StashPickerController({
            onStashCurrent: () => {
                void this.runStashCurrent().catch((error) => this.showAsyncError(error));
            },
            onApply: (ref) => {
                void this.runStashApply(ref).catch((error) => this.showAsyncError(error));
            },
            onPop: (ref) => {
                void this.runStashPop(ref).catch((error) => this.showAsyncError(error));
            },
            onDrop: (ref) => {
                void this.runStashDrop(ref).catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                this.stashState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    isOperationLoading() {
        return this.stashState === "loading" || super.isOperationLoading();
    }
    featureHelpContext() {
        if (this.stashState !== "closed") {
            return "stashPicker";
        }
        return super.featureHelpContext();
    }
    hasFeatureOverlay() {
        return this.stashState !== "closed" || super.hasFeatureOverlay();
    }
    renderFeatureOverlay(baseLines, width) {
        if (this.stashState !== "closed") {
            return this.renderStashOverlay(baseLines, width);
        }
        return super.renderFeatureOverlay(baseLines, width);
    }
    handleFeatureOverlayInput(data) {
        if (this.stashState !== "closed") {
            this.handleStashInput(data);
            return true;
        }
        return super.handleFeatureOverlayInput(data);
    }
    handleFeatureOpenInput(data) {
        if (data === "s") {
            if (!this.mutationActive()) {
                this.openStashPicker().catch((error) => this.showAsyncError(error));
            }
            return true;
        }
        return super.handleFeatureOpenInput(data);
    }
    async openStashPicker() {
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before using stashes";
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        this.error = undefined;
        this.stashState = "loading";
        this.stashPickerController.state = "loading";
        this.loadingMessage = "Loading stashes…";
        this.stashPickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        try {
            const stashes = await listStashes(this.pi, this.activePath(), this.viewerSignal);
            this.stashState = "open";
            this.stashPickerController.open(stashes);
        }
        catch (error) {
            this.setAsyncError(error);
            this.stashState = "closed";
            this.stashPickerController.state = "closed";
        }
        finally {
            this.loadingMessage = undefined;
            this.stashPickerController.loadingMessage = undefined;
            this.requestRender();
        }
    }
    handleStashInput(data) {
        if (this.stashState === "loading") {
            return;
        }
        this.stashPickerController.handleInput(data);
    }
    async runStashCurrent() {
        await this.runStashOperation("Stashing current changes…", (cwd, signal) => stashCurrentChanges(this.pi, cwd, signal), async (cwd, signal) => {
            const stashes = await listStashes(this.pi, cwd, signal);
            this.stashState = "open";
            this.stashPickerController.state = "open";
            this.stashPickerController.refreshStashes(stashes);
        });
    }
    async runStashApply(ref) {
        await this.runStashOperation(`Applying ${ref}…`, (cwd, signal) => applyStash(this.pi, cwd, ref, signal), async () => {
            this.stashState = "closed";
            this.stashPickerController.state = "closed";
        });
    }
    async runStashPop(ref) {
        await this.runStashOperation(`Popping ${ref}…`, (cwd, signal) => popStash(this.pi, cwd, ref, signal), async (cwd, signal) => {
            const stashes = await listStashes(this.pi, cwd, signal);
            this.stashState = "closed";
            this.stashPickerController.state = "closed";
            this.stashPickerController.refreshStashes(stashes);
        });
    }
    async runStashDrop(ref) {
        await this.runStashOperation(`Dropping ${ref}…`, (cwd, signal) => dropStash(this.pi, cwd, ref, signal), async (cwd, signal) => {
            const stashes = await listStashes(this.pi, cwd, signal);
            this.stashState = "open";
            this.stashPickerController.state = "open";
            this.stashPickerController.stashConfirmAction = undefined;
            this.stashPickerController.stashConfirmRef = "";
            this.stashPickerController.refreshStashes(stashes);
        });
    }
    async runStashOperation(label, operation, afterSuccess) {
        await this.runMutation("stash", async (signal) => {
            const cwd = this.activePath();
            let disposition;
            let documentApplied = false;
            this.stashState = "loading";
            this.stashPickerController.state = "loading";
            this.loadingMessage = label;
            this.stashPickerController.loadingMessage = this.loadingMessage;
            this.error = undefined;
            this.statusMessage = undefined;
            this.requestRender();
            try {
                const message = await operation(cwd, signal);
                disposition = await this.loadLatestDocument({
                    cwd,
                    target: `working:${cwd}`,
                    selection: "preserve-current-path",
                    load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
                    operationSignal: signal,
                });
                if (disposition === "applied") {
                    documentApplied = true;
                    this.statusMessage = message;
                    await afterSuccess(cwd, signal);
                }
            }
            catch (error) {
                if (this.setAsyncError(error)) {
                    if (!documentApplied)
                        await this.refreshWorkingTreeAfterStashFailure(cwd, signal);
                    this.stashState = "open";
                    this.stashPickerController.state = "open";
                }
            }
            finally {
                if (disposition !== "superseded") {
                    this.loadingMessage = undefined;
                    this.stashPickerController.loadingMessage = undefined;
                    this.requestRender();
                }
            }
        });
    }
    async refreshWorkingTreeAfterStashFailure(cwd, operationSignal) {
        if (this.document.mode !== "working")
            return;
        try {
            await this.loadLatestDocument({
                cwd,
                target: `working:${cwd}`,
                selection: "preserve-current-path",
                load: (signal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, signal)),
                operationSignal,
            });
        }
        catch (refreshError) {
            const stashError = this.error;
            if (this.setAsyncError(refreshError)) {
                this.error = `${stashError}; refresh failed: ${this.error}`;
            }
        }
    }
    renderStashOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.stashPickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-stash-picker.js.map