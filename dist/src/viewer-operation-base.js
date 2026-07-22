import { contextForDocumentLoad, loadDiffDocument } from "./diff-document-loader.js";
import { failureDetails } from "./failure-details.js";
import { refreshWorkingTreeDocument } from "./git-working-tree-refresh.js";
import { copyPluginSettings } from "./plugin-settings.js";
import { viewerActionAvailability } from "./viewer-action-policy.js";
import { ViewerDocumentState, } from "./viewer-document-state.js";
import { ViewerOperationCoordinator, } from "./viewer-operation-coordinator.js";
export class DiffViewerOperationBase {
    ctx;
    documentState;
    done;
    error;
    errorDetails;
    retainedFailure;
    getTerminalRows;
    loadingMessage;
    operationCoordinator;
    pi;
    pluginSettings;
    requestRender;
    settingsListTheme;
    statusMessage;
    theme;
    savePluginSettings;
    constructor(pi, ctx, theme, initialDocument, done, requestRender, getTerminalRows, viewerOptions) {
        this.pi = pi;
        this.ctx = ctx;
        this.theme = theme;
        this.done = done;
        this.requestRender = requestRender;
        this.getTerminalRows = getTerminalRows;
        this.pluginSettings = copyPluginSettings(viewerOptions.settings);
        this.settingsListTheme = viewerOptions.settingsListTheme;
        this.savePluginSettings = viewerOptions.saveSettings;
        this.documentState = new ViewerDocumentState(ctx.cwd, initialDocument);
        this.operationCoordinator = new ViewerOperationCoordinator({
            currentContext: () => ({ cwd: this.activePath(), generation: this.documentState.generation }),
            onChange: () => this.requestRender(),
            parentSignal: ctx.signal,
        });
    }
    get diffColumn() {
        return this.documentState.diffColumn;
    }
    set diffColumn(value) {
        this.documentState.diffColumn = value;
    }
    get diffScroll() {
        return this.documentState.diffScroll;
    }
    set diffScroll(value) {
        this.documentState.diffScroll = value;
    }
    get document() {
        return this.documentState.document;
    }
    get files() {
        return this.documentState.files;
    }
    get visibleSlice() {
        return this.documentState.slice;
    }
    get workingTreeView() {
        return this.documentState.workingTreeView;
    }
    get selectedFileIndex() {
        return this.documentState.selectedFileIndex;
    }
    set selectedFileIndex(value) {
        this.documentState.selectedFileIndex = value;
    }
    applyPluginSettings(settings) {
        this.pluginSettings = copyPluginSettings(settings);
        this.diffColumn = 0;
        this.diffScroll = 0;
    }
    persistPluginSettings(settings) {
        return this.savePluginSettings(settings);
    }
    activePath() {
        return this.documentState.activeCwd;
    }
    activeContext(signal = this.ctx.signal) {
        return contextForDocumentLoad(this.ctx, this.activePath(), signal);
    }
    operationSnapshot() {
        return this.operationCoordinator.snapshot;
    }
    currentFailureDetails() {
        const operationFailure = this.operationCoordinator.snapshot.failure;
        if (operationFailure) {
            return operationFailure;
        }
        if (this.documentState.failure) {
            return this.documentState.failure;
        }
        if (this.retainedFailure) {
            return this.retainedFailure;
        }
        if (!this.error) {
            return;
        }
        return { summary: this.error, details: this.errorDetails ?? this.error, cause: this.error };
    }
    requireViewerAction(action) {
        const availability = viewerActionAvailability(this.document, action);
        if (availability.available) {
            return true;
        }
        this.error = availability.reason ?? "That action is unavailable";
        this.errorDetails = this.error;
        this.statusMessage = undefined;
        this.requestRender();
        return false;
    }
    canStartForegroundOperation(action) {
        if (this.documentState.failure) {
            this.error = `Reload the diff with r before ${action}`;
            this.errorDetails = this.documentState.failure.details;
            this.statusMessage = undefined;
            this.requestRender();
            return false;
        }
        const reason = this.operationCoordinator.startBlockReason();
        if (!reason) {
            this.operationCoordinator.clearSettled();
            return true;
        }
        this.error =
            reason === "refreshRequired"
                ? `Retry the diff refresh with r before ${action}`
                : `Wait for the current operation before ${action}`;
        this.errorDetails = this.error;
        this.statusMessage = undefined;
        this.requestRender();
        return false;
    }
    prepareOperation() {
        this.error = undefined;
        this.errorDetails = undefined;
        this.retainedFailure = undefined;
        this.statusMessage = undefined;
    }
    retainFailureDetails(failure) {
        this.retainedFailure = failure;
    }
    runMutation(spec) {
        this.prepareOperation();
        if (this.documentState.failure) {
            return Promise.resolve({ kind: "rejected", reason: "refreshRequired" });
        }
        return this.operationCoordinator.runMutation(spec);
    }
    runLoad(spec) {
        this.prepareOperation();
        return this.operationCoordinator.runLoad(spec);
    }
    documentRefreshIntent(request = this.documentState.request, selection = this.documentState.captureSelection()) {
        return {
            label: "diff refresh",
            selection,
            run: ({ signal }) => loadDiffDocument(this.pi, this.ctx, request, signal),
            apply: (document) => this.documentState.replaceDocument(request, document, selection),
        };
    }
    workingTreeRefreshIntent(cwd = this.activePath(), selection = this.documentState.captureSelection(), scope = "full") {
        if (scope === "full" || this.document.mode !== "working") {
            return this.documentRefreshIntent({ kind: "working", cwd }, selection);
        }
        const current = this.document;
        const request = { kind: "working", cwd };
        return {
            label: "diff refresh",
            selection,
            run: async ({ signal }) => (await refreshWorkingTreeDocument(this.pi, this.activeContext(signal), current, scope)).document,
            apply: (document) => {
                if (document.mode === "working" && document.files === current.files)
                    this.documentState.updateMetadata(document);
                else
                    this.documentState.replaceDocument(request, document, selection);
            },
        };
    }
    async loadDocument(request, options) {
        const selection = options.selection ?? this.documentState.captureSelection();
        const outcome = await this.runLoad({
            label: request.kind === "working" ? "working tree" : `commit ${request.commit.hash}`,
            runningMessage: options.runningMessage,
            load: ({ signal }) => loadDiffDocument(this.pi, this.ctx, request, signal),
            apply: (document) => this.documentState.replaceDocument(request, document, selection),
            successMessage: options.successMessage === undefined ? undefined : () => options.successMessage,
        });
        if (outcome.kind === "failed" && options.recordFailure) {
            this.documentState.recordLoadFailure(request, outcome.failure.cause);
            this.operationCoordinator.clearSettled();
            this.requestRender();
        }
        return outcome;
    }
    async reloadCurrentDocument() {
        return this.loadDocument(this.documentState.reloadRequest, {
            runningMessage: "Reloading diff…",
            successMessage: "Diff reloaded",
            recordFailure: true,
        });
    }
    retryRefreshOnly() {
        this.prepareOperation();
        return this.operationCoordinator.retryRefresh();
    }
    cancelActiveOperation() {
        return this.operationCoordinator.cancelActive();
    }
    isOperationBusy() {
        return this.operationCoordinator.isBusy();
    }
    showOperationRejection(action) {
        if (this.documentState.failure) {
            this.error = `Reload the diff with r before ${action}`;
            this.errorDetails = this.documentState.failure.details;
        }
        else {
            this.error = `Cannot ${action} while another operation is active`;
            this.errorDetails = this.error;
        }
        this.statusMessage = undefined;
        this.requestRender();
    }
    showUnexpectedError(error) {
        const failure = failureDetails(error, "Unexpected operation failure");
        this.error = failure.summary;
        this.errorDetails = failure.details;
        this.loadingMessage = undefined;
        this.requestRender();
    }
}
//# sourceMappingURL=viewer-operation-base.js.map