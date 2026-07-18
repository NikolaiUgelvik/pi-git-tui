import { BranchPickerController } from "./branch-picker-controller.js";
import { loadWorkingTreeDiff } from "./git.js";
import { createAndSwitchBranch, listBranches, switchBranch } from "./git-extras.js";
import { DiffViewerActions } from "./viewer-actions.js";
export class DiffViewerBranchPicker extends DiffViewerActions {
    branchState = "closed";
    branchPickerController;
    constructor(...args) {
        super(...args);
        this.branchPickerController = new BranchPickerController({
            onSwitch: (name) => {
                void this.runBranchSwitch(name).catch((error) => this.showAsyncError(error));
            },
            onCreate: (name) => {
                void this.runBranchCreate(name).catch((error) => this.showAsyncError(error));
            },
            onValidationError: (message) => {
                this.error = message;
                this.statusMessage = undefined;
            },
            onClose: () => {
                this.branchState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    isOperationLoading() {
        return this.branchState === "loading" || super.isOperationLoading();
    }
    featureHelpContext() {
        if (this.branchState !== "closed") {
            return "branchPicker";
        }
        return super.featureHelpContext();
    }
    hasFeatureOverlay() {
        return this.branchState !== "closed" || super.hasFeatureOverlay();
    }
    renderFeatureOverlay(baseLines, width) {
        if (this.branchState !== "closed") {
            return this.renderBranchOverlay(baseLines, width);
        }
        return super.renderFeatureOverlay(baseLines, width);
    }
    handleFeatureOverlayInput(data) {
        if (this.branchState !== "closed") {
            this.handleBranchInput(data);
            return true;
        }
        return super.handleFeatureOverlayInput(data);
    }
    handleFeatureOpenInput(data) {
        if (data === "b") {
            if (!this.mutationActive()) {
                this.openBranchPicker().catch((error) => this.showAsyncError(error));
            }
            return true;
        }
        return super.handleFeatureOpenInput(data);
    }
    async openBranchPicker() {
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before switching branches";
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        this.error = undefined;
        this.branchState = "loading";
        this.branchPickerController.state = "loading";
        this.loadingMessage = "Loading branches…";
        this.branchPickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        try {
            const branches = await listBranches(this.pi, this.activePath(), this.viewerSignal);
            this.branchState = "open";
            this.branchPickerController.open(branches);
        }
        catch (error) {
            this.branchState = "closed";
            this.branchPickerController.state = "closed";
            this.setAsyncError(error);
        }
        finally {
            this.loadingMessage = undefined;
            this.branchPickerController.loadingMessage = undefined;
            this.requestRender();
        }
    }
    handleBranchInput(data) {
        if (this.branchState === "loading") {
            return;
        }
        this.branchPickerController.handleInput(data);
    }
    async runBranchSwitch(name) {
        await this.runBranchOperation("branch-switch", `Switching to ${name}…`, (cwd, signal) => switchBranch(this.pi, cwd, name, signal));
    }
    async runBranchCreate(name) {
        await this.runBranchOperation("branch-create", `Creating ${name}…`, (cwd, signal) => createAndSwitchBranch(this.pi, cwd, name, signal));
    }
    async runBranchOperation(kind, label, operation) {
        await this.runMutation(kind, (signal) => this.executeBranchOperation(label, operation, signal));
    }
    async reconcileBranchFailure(cwd, signal) {
        const operationError = this.error;
        try {
            const branches = await listBranches(this.pi, cwd, signal);
            this.branchState = "open";
            this.branchPickerController.open(branches);
            this.error = operationError;
        }
        catch (listError) {
            const detail = listError instanceof Error ? listError.message : String(listError);
            this.error = `${operationError}; branch list refresh failed: ${detail}`;
            this.branchState = "closed";
            this.branchPickerController.close();
        }
    }
    async executeBranchOperation(label, operation, signal) {
        const cwd = this.activePath();
        let disposition;
        this.branchState = "loading";
        this.branchPickerController.state = "loading";
        this.loadingMessage = label;
        this.branchPickerController.loadingMessage = label;
        this.requestRender();
        try {
            const message = await operation(cwd, signal);
            disposition = await this.loadLatestDocument({
                cwd,
                target: `working:${cwd}`,
                selection: "first",
                load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
                operationSignal: signal,
            });
            if (disposition === "applied") {
                this.statusMessage = message;
                this.error = undefined;
                this.branchState = "closed";
                this.branchPickerController.state = "closed";
            }
        }
        catch (error) {
            if (this.setAsyncError(error)) {
                disposition = await this.refreshWorkingTreeAfterMutationFailure(cwd, signal, "first");
                if (disposition === "applied")
                    await this.reconcileBranchFailure(cwd, signal);
            }
        }
        finally {
            if (disposition !== "superseded") {
                this.loadingMessage = undefined;
                this.branchPickerController.loadingMessage = undefined;
                this.requestRender();
            }
        }
    }
    renderBranchOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.branchPickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-branch-picker.js.map