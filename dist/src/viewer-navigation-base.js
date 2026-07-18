import { matchesKey } from "@earendil-works/pi-tui";
import { stageAllRemaining, stageRemainingFile, unstageAll, unstageFile } from "./git.js";
import { measureViewerGeometry, SPLIT_LAYOUT_MIN_WIDTH } from "./responsive-geometry.js";
import { buildTreeRows } from "./tree.js";
import { stagingBlockReason } from "./viewer-index-policy.js";
import { horizontalScrollDelta, arrowScrollDelta as inputArrowScrollDelta, isEnterInput, isPageDownInput, isPageUpInput, isPrintableInput as isPrintableKey, isShiftEnterInput, isViewerKey, } from "./viewer-key-input.js";
import { DiffViewerOperationBase } from "./viewer-operation-base.js";
export class DiffViewerNavigationBase extends DiffViewerOperationBase {
    focusedPanel = "tree";
    handleViewerNavigationInput(data) {
        const handlers = [
            () => this.handleReloadInput(data),
            () => this.handleFocusToggle(data),
            () => this.handleWorkingTreeViewInput(data),
            () => this.handleStageAllInput(data),
            () => this.handleFileStageToggle(data),
            () => this.handleFileStep(data),
            () => this.handleHorizontalScroll(data),
            () => this.handleArrowScroll(data),
            () => this.handlePageScroll(data),
            () => this.handleEdgeJump(data),
        ];
        for (const handler of handlers) {
            if (handler()) {
                return;
            }
        }
    }
    handleReloadInput(data) {
        if (data !== "r") {
            return false;
        }
        const operation = this.operationSnapshot();
        const reload = operation.canRetryRefresh ? this.retryRefreshOnly() : this.reloadCurrentDocument();
        reload.catch((error) => this.showAsyncError(error));
        return true;
    }
    handleFocusToggle(data) {
        if (!matchesKey(data, "tab")) {
            return false;
        }
        this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree";
        return true;
    }
    handleWorkingTreeViewInput(data) {
        if (data !== "v") {
            return false;
        }
        if (!this.requireViewerAction("toggleView")) {
            return true;
        }
        this.documentState.setWorkingTreeView(this.workingTreeView === "working" ? "staged" : "working");
        this.error = undefined;
        this.errorDetails = undefined;
        this.statusMessage = undefined;
        return true;
    }
    handleStageAllInput(data) {
        if (!this.isShiftEnter(data)) {
            return false;
        }
        if (!this.stagingAvailable("stageAll") || !this.canStartForegroundOperation("staging changes")) {
            return true;
        }
        this.stageAllVisibleChanges().catch((error) => this.showAsyncError(error));
        return true;
    }
    handleFileStageToggle(data) {
        if (!this.isEnter(data) || this.focusedPanel !== "tree") {
            return false;
        }
        if (!this.stagingAvailable("stageFile") || !this.canStartForegroundOperation("staging changes")) {
            return true;
        }
        const file = this.files[this.selectedFileIndex];
        if (file) {
            this.updateSelectedFileStage(file).catch((error) => this.showAsyncError(error));
        }
        return true;
    }
    stagingAvailable(action) {
        if (!this.requireViewerAction(action)) {
            return false;
        }
        if (this.documentState.failure) {
            this.error = "Reload the diff with r before staging changes";
            this.errorDetails = this.documentState.failure.details;
            this.statusMessage = undefined;
            return false;
        }
        const reason = stagingBlockReason(this.document);
        if (!reason) {
            return true;
        }
        this.error = reason;
        this.errorDetails = reason;
        this.statusMessage = undefined;
        return false;
    }
    handleFileStep(data) {
        if (this.isKey(data, "n")) {
            this.moveFile(1);
            return true;
        }
        if (this.isKey(data, "p")) {
            this.moveFile(-1);
            return true;
        }
        return false;
    }
    handleHorizontalScroll(data) {
        if (this.focusedPanel !== "diff") {
            return false;
        }
        const delta = horizontalScrollDelta(data);
        if (delta === 0) {
            return false;
        }
        this.diffColumn = Math.max(0, this.diffColumn + delta);
        return true;
    }
    handleArrowScroll(data) {
        const delta = this.arrowScrollDelta(data);
        if (delta === 0) {
            return false;
        }
        if (this.focusedPanel === "tree") {
            this.moveFile(delta);
        }
        else {
            this.scrollDiff(delta);
        }
        return true;
    }
    arrowScrollDelta(data) {
        return inputArrowScrollDelta(data);
    }
    handlePageScroll(data) {
        if (this.isPageUp(data)) {
            this.scrollDiff(-this.pageScrollSize());
            return true;
        }
        if (this.isPageDown(data) || matchesKey(data, "space")) {
            this.scrollDiff(this.pageScrollSize());
            return true;
        }
        return false;
    }
    handleEdgeJump(data) {
        if (matchesKey(data, "home")) {
            this.jumpToEdge("first");
            return true;
        }
        if (matchesKey(data, "end")) {
            this.jumpToEdge("last");
            return true;
        }
        return false;
    }
    jumpToEdge(edge) {
        if (this.focusedPanel === "tree") {
            this.selectTreeEdge(edge);
            return;
        }
        this.diffScroll = edge === "first" ? 0 : Number.MAX_SAFE_INTEGER;
    }
    isKey(data, key) {
        return isViewerKey(data, key);
    }
    isEnter(data) {
        return isEnterInput(data);
    }
    isShiftEnter(data) {
        return isShiftEnterInput(data);
    }
    isPageUp(data) {
        return isPageUpInput(data);
    }
    isPageDown(data) {
        return isPageDownInput(data);
    }
    isPrintableInput(data) {
        return isPrintableKey(data);
    }
    viewHeight() {
        return measureViewerGeometry({
            width: SPLIT_LAYOUT_MIN_WIDTH,
            terminalRows: this.getTerminalRows(),
            focusedPanel: this.focusedPanel,
            empty: false,
        }).panelRows;
    }
    pageScrollSize() {
        return Math.max(1, Math.ceil(this.viewHeight() / 2));
    }
    moveFile(delta) {
        const fileOrder = this.treeFileOrder();
        if (fileOrder.length === 0) {
            return;
        }
        const currentOrderIndex = Math.max(0, fileOrder.indexOf(this.selectedFileIndex));
        const nextOrderIndex = Math.max(0, Math.min(fileOrder.length - 1, currentOrderIndex + delta));
        this.selectedFileIndex = fileOrder[nextOrderIndex] ?? this.selectedFileIndex;
        this.diffScroll = 0;
    }
    selectTreeEdge(edge) {
        const fileOrder = this.treeFileOrder();
        if (fileOrder.length === 0) {
            return;
        }
        this.selectedFileIndex = fileOrder[edge === "first" ? 0 : fileOrder.length - 1] ?? this.selectedFileIndex;
        this.diffScroll = 0;
    }
    treeFileOrder() {
        return buildTreeRows(this.files)
            .map((row) => row.fileIndex)
            .filter((index) => index !== undefined);
    }
    scrollDiff(delta) {
        this.diffScroll = Math.max(0, this.diffScroll + delta);
    }
    resetSelectionToFirstTreeFile() {
        this.selectedFileIndex = this.treeFileOrder()[0] ?? 0;
        this.diffScroll = 0;
    }
    async updateSelectedFileStage(file) {
        if (!this.requireViewerAction("stageFile")) {
            return;
        }
        const cwd = this.activePath();
        const selection = this.documentState.captureSelection(file.path);
        const staging = this.workingTreeView === "working";
        const action = staging ? "stage remaining changes in" : "unstage";
        const outcome = await this.runMutation({
            label: `${action} ${file.path}`,
            runningMessage: `${staging ? "Staging remaining changes in" : "Unstaging"} ${file.path}…`,
            mutate: ({ signal }) => staging ? stageRemainingFile(this.pi, cwd, file, signal) : unstageFile(this.pi, cwd, file, signal),
            successMessage: (message) => message,
            refresh: this.workingTreeRefreshIntent(cwd, selection),
            reconcileOnFailure: true,
        });
        if (outcome.kind === "rejected") {
            this.showOperationRejection(staging ? "stage changes" : "unstage changes");
        }
    }
    async stageAllVisibleChanges() {
        if (!this.requireViewerAction("stageAll")) {
            return;
        }
        const cwd = this.activePath();
        const selection = this.documentState.captureSelection();
        const staging = this.workingTreeView === "working";
        const outcome = await this.runMutation({
            label: staging ? "stage all remaining changes" : "unstage all changes",
            runningMessage: staging ? "Staging all remaining changes…" : "Unstaging all changes…",
            mutate: ({ signal }) => (staging ? stageAllRemaining(this.pi, cwd, signal) : unstageAll(this.pi, cwd, signal)),
            successMessage: (message) => message,
            refresh: this.workingTreeRefreshIntent(cwd, selection),
            reconcileOnFailure: true,
        });
        if (outcome.kind === "rejected") {
            this.showOperationRejection(staging ? "stage changes" : "unstage changes");
        }
    }
    showAsyncError(error) {
        this.showUnexpectedError(error);
    }
}
//# sourceMappingURL=viewer-navigation-base.js.map