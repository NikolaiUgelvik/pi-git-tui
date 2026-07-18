import { loadWorkingTreeDiff } from "./git.js";
import { listWorktrees } from "./git-extras.js";
import { DiffViewerStashPicker } from "./viewer-stash-picker.js";
import { WorktreePickerController } from "./worktree-picker-controller.js";
export class DiffViewerWorktreePicker extends DiffViewerStashPicker {
    worktreeState = "closed";
    worktreePickerController;
    constructor(...args) {
        super(...args);
        this.worktreePickerController = new WorktreePickerController({
            onSwitch: (worktree) => {
                void this.switchToWorktree(worktree).catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                this.worktreeState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    isOperationLoading() {
        return this.worktreeState === "loading" || super.isOperationLoading();
    }
    featureHelpContext() {
        if (this.worktreeState !== "closed") {
            return "worktreePicker";
        }
        return super.featureHelpContext();
    }
    hasFeatureOverlay() {
        return this.worktreeState !== "closed" || super.hasFeatureOverlay();
    }
    renderFeatureOverlay(baseLines, width) {
        if (this.worktreeState !== "closed") {
            return this.renderWorktreeOverlay(baseLines, width);
        }
        return super.renderFeatureOverlay(baseLines, width);
    }
    handleFeatureOverlayInput(data) {
        if (this.worktreeState !== "closed") {
            this.handleWorktreeInput(data);
            return true;
        }
        return super.handleFeatureOverlayInput(data);
    }
    handleFeatureOpenInput(data) {
        if (data === "w") {
            if (!this.mutationActive()) {
                this.openWorktreePicker().catch((error) => this.showAsyncError(error));
            }
            return true;
        }
        return super.handleFeatureOpenInput(data);
    }
    async openWorktreePicker() {
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before switching worktrees";
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        this.error = undefined;
        this.worktreeState = "loading";
        this.worktreePickerController.state = "loading";
        this.loadingMessage = "Loading worktrees…";
        this.worktreePickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        try {
            const worktrees = await listWorktrees(this.pi, this.activePath(), this.viewerSignal);
            this.worktreeState = "open";
            this.worktreePickerController.open(worktrees, this.activePath());
        }
        catch (error) {
            this.worktreeState = "closed";
            this.worktreePickerController.state = "closed";
            this.setAsyncError(error);
        }
        finally {
            this.loadingMessage = undefined;
            this.worktreePickerController.loadingMessage = undefined;
            this.requestRender();
        }
    }
    handleWorktreeInput(data) {
        if (this.worktreeState === "loading") {
            return;
        }
        this.worktreePickerController.handleInput(data);
    }
    async switchToWorktree(worktree) {
        if (this.mutationActive())
            return;
        let disposition;
        this.worktreeState = "loading";
        this.worktreePickerController.state = "loading";
        this.loadingMessage = `Loading ${worktree.path}…`;
        this.worktreePickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        try {
            disposition = await this.loadLatestDocument({
                cwd: worktree.path,
                target: `working:${worktree.path}`,
                selection: "first",
                load: async (signal) => {
                    const document = await loadWorkingTreeDiff(this.pi, this.contextFor(worktree.path, signal));
                    if (document.repositoryState === "missing") {
                        throw new Error(`Worktree is no longer available: ${worktree.path}`);
                    }
                    return document;
                },
            });
            if (disposition === "applied") {
                this.error = undefined;
                this.statusMessage = `Viewing ${worktree.path}`;
                this.worktreeState = "closed";
                this.worktreePickerController.state = "closed";
            }
        }
        catch (error) {
            if (this.setAsyncError(error)) {
                const operationError = this.error;
                try {
                    const worktrees = await listWorktrees(this.pi, this.activePath(), this.viewerSignal);
                    this.worktreeState = "open";
                    this.worktreePickerController.open(worktrees, this.activePath());
                    this.error = operationError;
                }
                catch (listError) {
                    const detail = listError instanceof Error ? listError.message : String(listError);
                    this.error = `${operationError}; worktree list refresh failed: ${detail}`;
                    this.worktreePickerController.list.items = [];
                    this.worktreeState = "closed";
                    this.worktreePickerController.close();
                }
            }
        }
        finally {
            if (disposition !== "superseded") {
                this.loadingMessage = undefined;
                this.worktreePickerController.loadingMessage = undefined;
                this.requestRender();
            }
        }
    }
    renderWorktreeOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.worktreePickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-worktree-picker.js.map