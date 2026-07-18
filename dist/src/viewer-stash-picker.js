import { applyStash, dropStash, listStashes, popStash, stashCurrentChanges } from "./git-extras.js";
import { StashPickerController } from "./stash-picker-controller.js";
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js";
export class DiffViewerStashPicker extends DiffViewerBranchPicker {
    stashPickerController;
    stashState = "closed";
    stashListRequest = 0;
    stashMutationFeedback;
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
            onRetryList: () => {
                void this.retryStashList().catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                const wasLoading = this.stashState === "loading";
                this.stashListRequest += 1;
                this.stashState = "closed";
                this.loadingMessage = undefined;
                this.stashPickerController.loadingMessage = undefined;
                this.restoreStashMutationFeedback();
                if (wasLoading) {
                    this.cancelActiveOperation();
                }
            },
            onRequestRender: () => this.requestRender(),
        });
        this.featureOverlays.register("stash", {
            isActive: () => this.stashPickerController.state !== "closed",
            activeTextField: () => this.stashPickerController.state === "open" ? this.stashPickerController.list.searchField : undefined,
            helpContext: () => (this.stashPickerController.state === "confirm" ? "confirmDialog" : "stashPicker"),
            render: (baseLines, width) => this.renderStashOverlay(baseLines, width),
            handleInput: (data) => this.handleStashInput(data),
            handleOpen: (data) => {
                if (data !== "s") {
                    return false;
                }
                if (this.requireViewerAction("stashes") && this.canStartForegroundOperation("opening the stash picker")) {
                    this.openStashPicker().catch((error) => this.showAsyncError(error));
                }
                return true;
            },
            close: () => this.stashPickerController.close(),
        });
    }
    async openStashPicker() {
        if (!this.requireViewerAction("stashes")) {
            return;
        }
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before using stashes";
            this.errorDetails = this.error;
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        await this.loadStashList("open");
    }
    handleStashInput(data) {
        this.stashPickerController.handleInput(data);
        this.stashState = this.stashPickerController.state;
    }
    async runStashCurrent() {
        const outcome = await this.runStashOperation("Stashing current changes…", (cwd, signal) => stashCurrentChanges(this.pi, cwd, signal));
        if (outcome.kind === "succeeded") {
            await this.loadStashList("refresh", outcome.mutation);
        }
        else if (outcome.kind === "refreshFailed") {
            this.closeStashAfterMutation();
        }
    }
    async runStashApply(ref) {
        const outcome = await this.runStashOperation(`Applying ${ref}…`, (cwd, signal) => applyStash(this.pi, cwd, ref, signal));
        if (outcome.kind === "succeeded" || outcome.kind === "refreshFailed") {
            this.closeStashAfterMutation();
        }
    }
    async runStashPop(ref) {
        const outcome = await this.runStashOperation(`Popping ${ref}…`, (cwd, signal) => popStash(this.pi, cwd, ref, signal));
        if (outcome.kind === "succeeded" || outcome.kind === "refreshFailed") {
            this.closeStashAfterMutation();
        }
    }
    async runStashDrop(ref) {
        const outcome = await this.runStashOperation(`Dropping ${ref}…`, (cwd, signal) => dropStash(this.pi, cwd, ref, signal));
        if (outcome.kind === "succeeded") {
            this.stashPickerController.clearStashConfirmation();
            await this.loadStashList("refresh", outcome.mutation);
        }
        else if (outcome.kind === "refreshFailed") {
            this.closeStashAfterMutation();
        }
    }
    async runStashOperation(label, operation) {
        if (!this.requireViewerAction("stashes")) {
            this.closeStashAfterMutation();
            return { kind: "rejected", reason: "busy" };
        }
        const cwd = this.activePath();
        const selection = this.documentState.captureSelection();
        this.stashState = "loading";
        this.stashPickerController.state = "loading";
        this.loadingMessage = label;
        this.stashPickerController.loadingMessage = label;
        this.requestRender();
        try {
            const outcome = await this.runMutation({
                label: "stash operation",
                runningMessage: label,
                mutate: ({ signal }) => operation(cwd, signal),
                successMessage: (message) => message,
                refresh: this.workingTreeRefreshIntent(cwd, selection),
                reconcileOnFailure: true,
            });
            if (outcome.kind === "rejected") {
                this.showOperationRejection("run a stash operation");
            }
            if (outcome.kind === "cancelled" || outcome.kind === "stale") {
                this.closeStashAfterMutation();
            }
            else {
                this.stashState = "open";
                this.stashPickerController.state = "open";
            }
            return outcome;
        }
        finally {
            if (this.stashState === "loading") {
                this.stashState = "open";
                this.stashPickerController.state = "open";
            }
            this.loadingMessage = undefined;
            this.stashPickerController.loadingMessage = undefined;
            this.requestRender();
        }
    }
    async retryStashList() {
        if (!this.requireViewerAction("stashes") || !this.canStartForegroundOperation("retrying the stash list")) {
            return;
        }
        await this.loadStashList("refresh", this.statusMessage);
    }
    async loadStashList(mode, retainedSuccess) {
        const requestId = ++this.stashListRequest;
        const cwd = this.activePath();
        if (mode === "open") {
            this.stashMutationFeedback = undefined;
        }
        else if (retainedSuccess) {
            this.stashMutationFeedback = retainedSuccess;
        }
        this.beginStashListLoad(mode);
        try {
            const loading = this.runLoad({
                label: "stash list",
                runningMessage: this.loadingMessage ?? "Loading stashes…",
                load: ({ signal }) => listStashes(this.pi, cwd, signal),
                apply: (stashes) => this.applyStashList(requestId, mode, stashes),
                reportFailure: mode === "open",
            });
            this.restoreStashMutationFeedback();
            const outcome = await loading;
            this.restoreStashMutationFeedback();
            if (requestId === this.stashListRequest) {
                this.applyStashListOutcome(mode, outcome, retainedSuccess);
            }
        }
        finally {
            this.restoreStashMutationFeedback();
            this.finishStashListLoad(requestId, mode);
            this.requestRender();
        }
    }
    beginStashListLoad(mode) {
        this.stashState = "loading";
        this.stashPickerController.state = "loading";
        this.loadingMessage = mode === "open" ? "Loading stashes…" : "Refreshing stashes…";
        this.stashPickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
    }
    applyStashList(requestId, mode, stashes) {
        if (requestId !== this.stashListRequest || this.stashState === "closed") {
            return;
        }
        this.stashState = "open";
        if (mode === "open") {
            this.stashPickerController.open(stashes);
            return;
        }
        this.stashPickerController.state = "open";
        this.stashPickerController.refreshStashes(stashes);
    }
    applyStashListOutcome(mode, outcome, retainedSuccess) {
        if (outcome.kind === "failed" && mode === "refresh") {
            this.stashState = "open";
            this.stashPickerController.state = "open";
            this.retainFailureDetails(outcome.failure);
            this.stashPickerController.showListWarning(`Stash list refresh failed: ${outcome.failure.summary}`);
        }
        else if (outcome.kind !== "succeeded") {
            this.stashState = "closed";
            this.stashPickerController.state = "closed";
        }
        if (retainedSuccess) {
            this.statusMessage = retainedSuccess;
        }
    }
    finishStashListLoad(requestId, mode) {
        if (requestId !== this.stashListRequest) {
            return;
        }
        if (this.stashState === "loading") {
            this.stashState = mode === "refresh" ? "open" : "closed";
            this.stashPickerController.state = this.stashState;
        }
        this.loadingMessage = undefined;
        this.stashPickerController.loadingMessage = undefined;
        this.requestRender();
    }
    restoreStashMutationFeedback() {
        if (this.stashMutationFeedback) {
            this.statusMessage = this.stashMutationFeedback;
        }
    }
    closeStashAfterMutation() {
        this.stashListRequest += 1;
        this.stashState = "closed";
        this.stashPickerController.state = "closed";
    }
    renderStashOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.stashPickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-stash-picker.js.map