import { matchesKey } from "@earendil-works/pi-tui";
import { isGitAbortError } from "./git-service.js";
import { fit } from "./render-text.js";
import { isEnterInput, isHelpCloseInput as isHelpCloseKey, isHelpKey as isHelpOpenKey, isPrintableInput as isPrintableKey, isViewerKey, } from "./viewer-key-input.js";
import { ViewerOperationCoordinator, } from "./viewer-operation-coordinator.js";
import { ViewerRenderCache } from "./viewer-render-cache.js";
function logicalChangeKey(file) {
    return JSON.stringify([
        file.path,
        file.oldPath,
        file.newPath,
        file.status,
        file.staged,
        file.untracked,
        file.untrackedRole,
        file.submodule,
    ]);
}
function sameLogicalChange(left, right) {
    return logicalChangeKey(left) === logicalChangeKey(right);
}
function occurrenceBefore(files, index, matches) {
    return files.slice(0, index).filter(matches).length;
}
function fileSelectionSnapshot(files, index) {
    const file = files[index];
    if (!file)
        return;
    return {
        file,
        exactOccurrence: occurrenceBefore(files, index, (candidate) => sameLogicalChange(candidate, file)),
        pathOccurrence: occurrenceBefore(files, index, (candidate) => candidate.path === file.path),
    };
}
function matchingIndex(files, occurrence, matches) {
    const indexes = files.flatMap((file, index) => (matches(file) ? [index] : []));
    return indexes[occurrence] ?? indexes[0];
}
function preservedFileIndex(files, selection) {
    return (matchingIndex(files, selection.exactOccurrence, (file) => sameLogicalChange(file, selection.file)) ??
        matchingIndex(files, selection.pathOccurrence, (file) => file.path === selection.file.path));
}
export class DiffViewerCore {
    getTerminalRows;
    document;
    pi;
    ctx;
    theme;
    done;
    requestRender;
    viewerSignal;
    operationCoordinator;
    activeCwd;
    renderCache;
    viewerAbortController = new AbortController();
    contextSignal;
    abortFromContext = () => this.viewerAbortController.abort();
    viewerClosed = false;
    selectedFileIndex = 0;
    diffScroll = 0;
    focusedPanel = "tree";
    commitMessage = "";
    commitMessageCaret = 0;
    commitAmend = false;
    pickerState = "closed";
    commandMenuState = "closed";
    commitDialogState = "closed";
    helpContext;
    loadingMessage;
    statusMessage;
    error;
    constructor(pi, ctx, theme, document, done, requestRender, getTerminalRows) {
        this.getTerminalRows = getTerminalRows;
        this.pi = pi;
        this.ctx = ctx;
        this.theme = theme;
        this.document = document;
        this.done = done;
        this.requestRender = () => {
            if (!this.viewerClosed && !this.viewerAbortController.signal.aborted) {
                requestRender();
            }
        };
        this.activeCwd = ctx.cwd;
        this.contextSignal = ctx.signal;
        this.viewerSignal = this.viewerAbortController.signal;
        if (this.contextSignal?.aborted) {
            this.viewerAbortController.abort();
        }
        else {
            this.contextSignal?.addEventListener("abort", this.abortFromContext, { once: true });
        }
        this.operationCoordinator = new ViewerOperationCoordinator({ signal: this.viewerSignal });
        this.renderCache = new ViewerRenderCache(document.files);
        this.resetSelectionToFirstTreeFile();
    }
    activePath() {
        return this.activeCwd;
    }
    activeContext(signal = this.viewerSignal) {
        return this.contextFor(this.activePath(), signal);
    }
    contextFor(cwd, signal = this.viewerSignal) {
        return { ...this.ctx, cwd, signal };
    }
    handleHelpInput(data) {
        if (this.helpContext !== undefined) {
            if (this.isHelpCloseInput(data)) {
                this.helpContext = undefined;
                this.requestRender();
            }
            return true;
        }
        if (!this.isHelpKey(data)) {
            return false;
        }
        this.helpContext = this.currentHelpContext();
        this.requestRender();
        return true;
    }
    isHelpCloseInput(data) {
        return isHelpCloseKey(data);
    }
    isHelpKey(data) {
        return isHelpOpenKey(data);
    }
    currentHelpContext() {
        if (this.commitDialogState !== "closed") {
            return "commitDialog";
        }
        if (this.commandMenuState !== "closed") {
            return "commandMenu";
        }
        if (this.pickerState !== "closed") {
            return "commitPicker";
        }
        return "viewer";
    }
    isOperationLoading() {
        return (this.operationCoordinator.mutationActive ||
            this.pickerState === "loading" ||
            this.commandMenuState === "loading" ||
            this.commitDialogState === "loading");
    }
    mutationActive() {
        return this.operationCoordinator.mutationActive;
    }
    handleActiveOverlayInput(data) {
        if (this.commitDialogState !== "closed") {
            this.handleCommitDialogInput(data);
            return true;
        }
        if (this.commandMenuState !== "closed") {
            this.handleCommandMenuInput(data);
            return true;
        }
        if (this.pickerState !== "closed") {
            this.handleCommitPickerInput(data);
            return true;
        }
        return false;
    }
    handleCloseInput(data) {
        if (!this.isKey(data, "q") && !matchesKey(data, "escape")) {
            return false;
        }
        this.closeViewer();
        return true;
    }
    handleOpenOverlayInput(data) {
        const handlers = [
            () => this.handleOpenCommitDialogInput(data),
            () => this.handleOpenPickerInput(data),
            () => this.handleOpenCommandMenuInput(data),
        ];
        return handlers.some((handler) => handler());
    }
    handleOpenPickerInput(data) {
        if (data !== "c") {
            return false;
        }
        if (!this.mutationActive()) {
            this.openCommitPicker().catch((error) => this.showAsyncError(error));
        }
        return true;
    }
    handleOpenCommitDialogInput(data) {
        if (data !== "C") {
            return false;
        }
        if (!this.mutationActive()) {
            this.openCommitDialog();
        }
        return true;
    }
    handleOpenCommandMenuInput(data) {
        if (!matchesKey(data, "ctrl+p")) {
            return false;
        }
        if (!this.mutationActive()) {
            this.openCommandMenu();
        }
        return true;
    }
    isKey(data, key) {
        return isViewerKey(data, key);
    }
    isEnter(data) {
        return isEnterInput(data);
    }
    isPrintableInput(data) {
        return isPrintableKey(data);
    }
    showAsyncError(error) {
        if (!this.setAsyncError(error)) {
            return;
        }
        this.statusMessage = undefined;
        this.pickerState = "closed";
        this.commandMenuState = "closed";
        this.commitDialogState = "closed";
        this.loadingMessage = undefined;
        this.requestRender();
    }
    renderOverlays(baseLines, width) {
        return baseLines.map((line) => fit(line, width));
    }
    setAsyncError(error) {
        if (isGitAbortError(error)) {
            return false;
        }
        this.error = error instanceof Error ? error.message : String(error);
        return true;
    }
    closeViewer() {
        if (this.viewerClosed) {
            return;
        }
        this.viewerClosed = true;
        this.contextSignal?.removeEventListener("abort", this.abortFromContext);
        this.operationCoordinator.dispose();
        this.viewerAbortController.abort();
        this.done();
    }
    handleCommitDialogInput(_data) { }
    handleCommandMenuInput(_data) { }
    handleCommitPickerInput(_data) { }
    openCommitPicker() {
        return Promise.resolve();
    }
    openCommitDialog() { }
    openCommandMenu() { }
    viewHeight() {
        // The custom diff viewer is shown as an overlay with a 1-row margin. Keep the
        // component shorter than the visible terminal so re-renders never push content
        // into scrollback when users browse with arrow keys or PageUp/PageDown.
        const maxTotalLines = Math.max(10, this.getTerminalRows() - 2);
        const chromeLines = 7; // border, header, subtitle, dividers, footer, border
        return Math.max(5, maxTotalLines - chromeLines);
    }
    pageScrollSize() {
        return Math.max(1, Math.floor((this.viewHeight() - 1) / 2));
    }
    moveFile(delta) {
        const fileOrder = this.treeFileOrder();
        if (fileOrder.length === 0) {
            return;
        }
        const currentOrderIndex = this.renderCache.treeFileOrderIndex(this.selectedFileIndex) ?? 0;
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
        return this.renderCache.treeFileOrder();
    }
    treeRows() {
        return this.renderCache.treeRows();
    }
    treeRowIndex(fileIndex) {
        return this.renderCache.treeRowIndex(fileIndex);
    }
    selectedFileDisplay() {
        return this.renderCache.selectedFileDisplay(this.selectedFileIndex);
    }
    renderCacheStats() {
        return this.renderCache.stats();
    }
    invalidateRenderCache() {
        this.renderCache.invalidate();
    }
    scrollDiff(delta) {
        this.diffScroll = Math.max(0, this.diffScroll + delta);
    }
    resetSelectionToFirstTreeFile() {
        this.selectedFileIndex = this.treeFileOrder()[0] ?? 0;
        this.diffScroll = 0;
    }
    selectFileByPath(path) {
        const fileIndex = this.renderCache.fileIndexForPath(path);
        if (fileIndex === undefined) {
            return false;
        }
        this.selectedFileIndex = fileIndex;
        this.diffScroll = 0;
        return true;
    }
    runMutation(kind, task) {
        return this.operationCoordinator.runMutation(kind, task);
    }
    loadLatestDocument(request) {
        return this.operationCoordinator.applyLatest(request.target, request.load, (document) => {
            this.applyDocument(document, request.cwd, request.selection);
        }, request.operationSignal);
    }
    applyDocument(document, cwd, selection) {
        const selected = fileSelectionSnapshot(this.document.files, this.selectedFileIndex);
        const preservesContent = selection === "preserve-current-path" && document.files === this.document.files;
        this.document = document;
        this.renderCache.replaceDocument(document.files);
        this.activeCwd = cwd;
        if (preservesContent)
            return;
        const preservedIndex = selected ? preservedFileIndex(document.files, selected) : undefined;
        if (selection === "preserve-current-path" && preservedIndex !== undefined) {
            this.selectedFileIndex = preservedIndex;
            this.diffScroll = 0;
            return;
        }
        this.resetSelectionToFirstTreeFile();
    }
}
//# sourceMappingURL=viewer-core.js.map