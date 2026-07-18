import { matchesKey } from "@earendil-works/pi-tui";
import { BranchPickerController } from "./branch-picker-controller.js";
import { createAndSwitchBranch, listBranches, switchBranch } from "./git-extras.js";
import { DiffViewerActions } from "./viewer-actions.js";
export class DiffViewerBranchPicker extends DiffViewerActions {
    branchPickerController;
    branchState = "closed";
    branchRequest = 0;
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
                this.errorDetails = message;
                this.statusMessage = undefined;
            },
            onClose: () => {
                this.branchRequest += 1;
                this.branchState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
        this.featureOverlays.register("branch", {
            isActive: () => this.branchState !== "closed",
            activeTextField: () => this.branchPickerController.activeTextField(),
            helpContext: () => "branchPicker",
            render: (baseLines, width) => this.renderBranchOverlay(baseLines, width),
            handleInput: (data) => this.handleBranchInput(data),
            handleOpen: (data) => {
                if (data !== "b") {
                    return false;
                }
                if (this.requireViewerAction("branches") && this.canStartForegroundOperation("opening the branch picker")) {
                    this.openBranchPicker().catch((error) => this.showAsyncError(error));
                }
                return true;
            },
            close: () => this.branchPickerController.close(),
        });
    }
    async openBranchPicker() {
        if (!this.requireViewerAction("branches")) {
            return;
        }
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before switching branches";
            this.errorDetails = this.error;
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        const requestId = ++this.branchRequest;
        const cwd = this.activePath();
        this.branchState = "loading";
        this.branchPickerController.state = "loading";
        this.loadingMessage = "Loading branches…";
        this.branchPickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        const outcome = await this.runLoad({
            label: "branches",
            runningMessage: "Loading branches…",
            load: ({ signal }) => listBranches(this.pi, cwd, signal),
            apply: (branches) => {
                if (requestId !== this.branchRequest || this.branchState === "closed") {
                    return;
                }
                this.branchState = "open";
                this.branchPickerController.open(branches);
            },
        });
        if (requestId !== this.branchRequest) {
            return;
        }
        if (outcome.kind !== "succeeded") {
            this.branchState = "closed";
            this.branchPickerController.state = "closed";
        }
        this.loadingMessage = undefined;
        this.branchPickerController.loadingMessage = undefined;
        this.requestRender();
    }
    handleBranchInput(data) {
        if (this.branchState === "loading") {
            if (matchesKey(data, "escape")) {
                this.branchRequest += 1;
                this.branchState = "closed";
                this.branchPickerController.state = "closed";
                this.loadingMessage = undefined;
                this.branchPickerController.loadingMessage = undefined;
                this.cancelActiveOperation();
                this.requestRender();
            }
            return;
        }
        this.branchPickerController.handleInput(data);
    }
    async runBranchSwitch(name) {
        await this.runBranchOperation(`Switching to ${name}…`, "open", (cwd, signal) => switchBranch(this.pi, cwd, name, signal));
    }
    async runBranchCreate(name) {
        await this.runBranchOperation(`Creating ${name}…`, "create", (cwd, signal) => createAndSwitchBranch(this.pi, cwd, name, signal));
    }
    async runBranchOperation(label, failureState, operation) {
        if (!this.requireViewerAction("branches")) {
            this.branchState = "closed";
            this.branchPickerController.state = "closed";
            return;
        }
        const requestId = ++this.branchRequest;
        const cwd = this.activePath();
        const selection = this.documentState.captureSelection();
        this.branchState = "loading";
        this.branchPickerController.state = "loading";
        this.loadingMessage = label;
        this.branchPickerController.loadingMessage = label;
        this.requestRender();
        const outcome = await this.runMutation({
            label: "branch operation",
            runningMessage: label,
            mutate: ({ signal }) => operation(cwd, signal),
            successMessage: (message) => message,
            refresh: this.workingTreeRefreshIntent(cwd, selection),
        });
        if (requestId !== this.branchRequest) {
            return;
        }
        if (outcome.kind === "mutationFailed") {
            this.branchState = failureState;
            this.branchPickerController.state = failureState;
        }
        else if (outcome.kind === "rejected") {
            this.branchState = failureState;
            this.branchPickerController.state = failureState;
            this.showOperationRejection("change branches");
        }
        else {
            this.branchState = "closed";
            this.branchPickerController.state = "closed";
        }
        this.loadingMessage = undefined;
        this.branchPickerController.loadingMessage = undefined;
        this.requestRender();
    }
    renderBranchOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.branchPickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-branch-picker.js.map