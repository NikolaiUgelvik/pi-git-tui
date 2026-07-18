import { buildCommitDocument, diffFileAliases, emptyWorkingTreeDocument, selectDiffSlice } from "./diff-document.js";
import { failureDetails } from "./failure-details.js";
import { buildTreeRows } from "./tree.js";
function documentLoadFailure(request, error) {
    return { ...failureDetails(error, "Failed to load git diff"), request };
}
export function loadedViewerDocument(document, request) {
    return { status: "loaded", document, request };
}
export function failedViewerDocument(request, error) {
    return { status: "failed", request, failure: documentLoadFailure(request, error) };
}
function inferredRequest(document, cwd) {
    if (document.mode === "commit") {
        return { kind: "commit", cwd, commit: document.commit };
    }
    return { kind: "working", cwd };
}
function unavailableDocument(request) {
    if (request.kind === "commit") {
        return buildCommitDocument({
            title: "Diff unavailable",
            subtitle: request.cwd,
            raw: "",
            commit: request.commit,
        });
    }
    return emptyWorkingTreeDocument("Diff unavailable", request.cwd);
}
function isInitialState(value) {
    return "status" in value;
}
function requestsMatch(left, right) {
    if (left.kind !== right.kind || left.cwd !== right.cwd) {
        return false;
    }
    return left.kind === "working" || (right.kind === "commit" && left.commit.hash === right.commit.hash);
}
export class ViewerDocumentState {
    _activeCwd;
    _diffColumn = 0;
    _diffScroll = 0;
    _document;
    _failedTarget;
    _failure;
    _generation = 0;
    _reloadRequest;
    _request;
    _selectedFileIndex = 0;
    _workingTreeView = "working";
    constructor(initialCwd, initial) {
        if (!isInitialState(initial)) {
            this._activeCwd = initialCwd;
            this._document = initial;
            this._request = inferredRequest(initial, initialCwd);
            this._selectedFileIndex = this.selectionIndex(initial, { aliases: [] });
            return;
        }
        if (initial.status === "loaded") {
            const request = initial.request ?? inferredRequest(initial.document, initialCwd);
            this._activeCwd = request.cwd;
            this._document = initial.document;
            this._request = request;
            this._selectedFileIndex = this.selectionIndex(initial.document, { aliases: [] });
            return;
        }
        this._activeCwd = initial.request.cwd;
        this._document = unavailableDocument(initial.request);
        this._failure = initial.failure;
        this._reloadRequest = initial.request;
        this._request = initial.request;
    }
    get activeCwd() {
        return this._activeCwd;
    }
    get diffColumn() {
        return this._diffColumn;
    }
    set diffColumn(value) {
        this._diffColumn = Math.max(0, value);
    }
    get diffScroll() {
        return this._diffScroll;
    }
    set diffScroll(value) {
        this._diffScroll = Math.max(0, value);
    }
    get document() {
        return this._document;
    }
    get failedTarget() {
        return this._failedTarget;
    }
    get failure() {
        return this._failure;
    }
    get files() {
        return this.slice.files;
    }
    get generation() {
        return this._generation;
    }
    get reloadRequest() {
        return this._reloadRequest ?? this._request;
    }
    get request() {
        return this._request;
    }
    get selectedFileIndex() {
        return this._selectedFileIndex;
    }
    set selectedFileIndex(value) {
        const maxIndex = Math.max(0, this.files.length - 1);
        const nextIndex = Math.max(0, Math.min(maxIndex, value));
        if (nextIndex !== this._selectedFileIndex) {
            this._diffColumn = 0;
        }
        this._selectedFileIndex = nextIndex;
    }
    get slice() {
        return selectDiffSlice(this._document, this._workingTreeView);
    }
    get workingTreeView() {
        return this._workingTreeView;
    }
    captureSelection(preferredPath) {
        const selected = preferredPath
            ? this.files.find((file) => diffFileAliases(file).includes(preferredPath))
            : this.files[this._selectedFileIndex];
        const aliases = diffFileAliases(selected);
        return {
            preferredPath: preferredPath ?? selected?.path,
            aliases,
            status: selected?.status,
            stageState: selected?.stageState,
            untracked: selected?.untracked,
        };
    }
    replaceDocument(request, document, selection = this.captureSelection()) {
        this._document = document;
        this._activeCwd = request.cwd;
        this._request = request;
        this._failedTarget = undefined;
        this._failure = undefined;
        this._reloadRequest = undefined;
        this._generation += 1;
        this._selectedFileIndex = this.selectionIndex(document, selection);
        this._diffColumn = 0;
        this._diffScroll = 0;
    }
    updateMetadata(document) {
        this._document = document;
        this._failure = undefined;
        this._failedTarget = undefined;
        this._reloadRequest = undefined;
    }
    recordLoadFailure(request, error) {
        const failure = documentLoadFailure(request, error);
        if (requestsMatch(request, this._request)) {
            this._failure = failure;
            this._failedTarget = undefined;
        }
        else {
            this._failedTarget = failure;
        }
        this._reloadRequest = request;
        this._diffColumn = 0;
        this._diffScroll = 0;
        return failure;
    }
    abandonFailedTarget() {
        if (!this._failedTarget) {
            return false;
        }
        this._failedTarget = undefined;
        this._reloadRequest = undefined;
        return true;
    }
    setWorkingTreeView(view) {
        if (this._document.mode !== "working") {
            return false;
        }
        if (this._workingTreeView === view) {
            return true;
        }
        const selection = this.captureSelection();
        this._workingTreeView = view;
        this._selectedFileIndex = this.selectionIndex(this._document, selection);
        this._diffColumn = 0;
        this._diffScroll = 0;
        return true;
    }
    selectionIndex(document, selection) {
        const files = selectDiffSlice(document, this._workingTreeView).files;
        const aliases = new Set([selection.preferredPath, ...selection.aliases].filter((path) => !!path));
        const firstTreeFile = buildTreeRows(files).find((row) => row.fileIndex !== undefined)?.fileIndex ?? 0;
        if (aliases.size === 0) {
            return firstTreeFile;
        }
        const candidates = files
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => diffFileAliases(file).some((path) => aliases.has(path)));
        const exact = candidates.find(({ file }) => file.status === selection.status &&
            file.stageState === selection.stageState &&
            Boolean(file.untracked) === Boolean(selection.untracked));
        return exact?.index ?? candidates[0]?.index ?? firstTreeFile;
    }
}
//# sourceMappingURL=viewer-document-state.js.map