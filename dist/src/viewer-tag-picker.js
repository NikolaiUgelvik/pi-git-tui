import { matchesKey } from "@earendil-works/pi-tui";
import { loadCommits } from "./git.js";
import { createTag, listTags } from "./git-extras.js";
import { TagPickerController } from "./tag-picker-controller.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export class DiffViewerTagPicker extends DiffViewerWorktreePicker {
    tagPickerController;
    tagRequest = 0;
    tagLoadingReturnState = "closed";
    constructor(...args) {
        super(...args);
        this.tagPickerController = new TagPickerController({
            onSelect: (tag) => {
                void this.viewTag(tag).catch((error) => this.showAsyncError(error));
            },
            onRequestTargets: () => {
                void this.loadTagTargets().catch((error) => this.showAsyncError(error));
            },
            onCreate: (creation) => {
                void this.runTagCreate(creation).catch((error) => this.showAsyncError(error));
            },
            onValidationError: (message) => {
                this.error = message;
                this.errorDetails = message;
                this.statusMessage = undefined;
            },
            onClose: () => {
                this.tagRequest += 1;
                this.loadingMessage = undefined;
                this.tagPickerController.loadingMessage = undefined;
                this.cancelActiveOperation();
            },
            onRequestRender: () => this.requestRender(),
        });
        this.featureOverlays.register("tag", {
            isActive: () => this.tagPickerController.state !== "closed",
            activeTextField: () => this.tagPickerController.activeTextField(),
            helpContext: () => "tagPicker",
            render: (baseLines, width) => this.renderTagOverlay(baseLines, width),
            handleInput: (data) => this.handleTagInput(data),
            handleOpen: (data) => {
                if (data !== "t")
                    return false;
                if (this.requireViewerAction("tags") && this.canStartForegroundOperation("opening the tag picker")) {
                    void this.loadTagList().catch((error) => this.showAsyncError(error));
                }
                return true;
            },
            close: () => this.tagPickerController.close(),
        });
    }
    get tagState() {
        return this.tagPickerController.state;
    }
    handleTagInput(data) {
        if (this.tagPickerController.state === "loading") {
            if (matchesKey(data, "escape"))
                this.cancelTagOperation();
            return;
        }
        this.tagPickerController.handleInput(data);
    }
    cancelTagOperation() {
        if (this.tagLoadingReturnState === "create") {
            this.loadingMessage = "Cancelling tag creation…";
            this.tagPickerController.loadingMessage = this.loadingMessage;
        }
        else {
            this.tagRequest += 1;
            this.tagPickerController.state = this.tagLoadingReturnState;
            this.loadingMessage = undefined;
            this.tagPickerController.loadingMessage = undefined;
        }
        this.cancelActiveOperation();
        this.requestRender();
    }
    async loadTagList() {
        if (!this.requireViewerAction("tags"))
            return;
        const requestId = ++this.tagRequest;
        const cwd = this.activePath();
        this.beginTagLoading("Loading tags…", "closed");
        const outcome = await this.runLoad({
            label: "tag list",
            runningMessage: "Loading tags…",
            load: ({ signal }) => listTags(this.pi, cwd, signal),
            apply: (tags) => {
                if (requestId !== this.tagRequest || this.tagPickerController.state === "closed")
                    return;
                this.tagPickerController.open(tags);
            },
        });
        if (requestId !== this.tagRequest)
            return;
        if (outcome.kind !== "succeeded")
            this.tagPickerController.state = "closed";
        this.finishTagLoading();
    }
    async loadTagTargets() {
        if (!this.requireViewerAction("tags") || !this.canStartForegroundOperation("loading tag target commits"))
            return;
        const requestId = ++this.tagRequest;
        const cwd = this.activePath();
        const displayedCommit = this.document.mode === "commit" ? this.document.commit : undefined;
        this.beginTagLoading("Loading target commits…", "open");
        const outcome = await this.runLoad({
            label: "tag target commits",
            runningMessage: "Loading target commits…",
            load: ({ signal }) => loadCommits(this.pi, cwd, signal),
            apply: (commits) => {
                if (requestId !== this.tagRequest || this.tagPickerController.state === "closed")
                    return;
                const targets = displayedCommit && !commits.some((commit) => commit.hash === displayedCommit.hash)
                    ? [displayedCommit, ...commits]
                    : commits;
                this.tagPickerController.openTargetSelection(targets);
            },
        });
        if (requestId !== this.tagRequest)
            return;
        if (outcome.kind !== "succeeded") {
            this.tagPickerController.state = "open";
        }
        this.finishTagLoading();
    }
    async viewTag(tag) {
        if (!this.requireViewerAction("tags"))
            return;
        if (tag.targetType !== "commit") {
            const message = `${tag.name} points to a ${tag.targetType}, not a commit`;
            this.error = message;
            this.errorDetails = message;
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        if (!this.canStartForegroundOperation("loading a tag"))
            return;
        const requestId = ++this.tagRequest;
        this.beginTagLoading(`Loading ${tag.name}…`, "open");
        const outcome = await this.loadDocument({
            kind: "commit",
            cwd: this.activePath(),
            commit: { hash: tag.targetHash, message: tag.targetSubject ?? tag.annotation ?? tag.name },
        }, { runningMessage: `Loading ${tag.name}…`, successMessage: `Viewing tag ${tag.name}`, recordFailure: true });
        if (requestId !== this.tagRequest)
            return;
        this.tagPickerController.state = outcome.kind === "succeeded" ? "closed" : "open";
        this.finishTagLoading();
    }
    async runTagCreate(creation) {
        if (!this.requireViewerAction("tags") || !this.canStartForegroundOperation("creating a tag"))
            return;
        const requestId = ++this.tagRequest;
        const cwd = this.activePath();
        this.beginTagLoading(`Creating ${creation.name}…`, "create");
        const outcome = await this.runMutation({
            label: "create tag",
            runningMessage: `Creating ${creation.name}…`,
            mutate: ({ signal }) => createTag(this.pi, cwd, creation.name, creation.target.hash, creation.annotated, creation.message, signal),
            successMessage: (message) => message,
            refresh: this.tagListRefreshIntent(cwd, creation.name),
        });
        if (requestId !== this.tagRequest)
            return;
        if (outcome.kind === "succeeded") {
            this.tagPickerController.showTagList();
        }
        else if (outcome.kind === "refreshFailed") {
            this.tagPickerController.state = "closed";
        }
        else if (outcome.kind === "cancelled" && this.tagPickerController.state === "open") {
            // Reconciliation observed the tag even if Git completed after cancellation.
        }
        else {
            this.tagPickerController.state = "create";
            if (outcome.kind === "rejected")
                this.showOperationRejection("create a tag");
        }
        this.finishTagLoading();
    }
    tagListRefreshIntent(cwd, expectedTagName) {
        return {
            label: "tag list refresh",
            run: ({ signal }) => listTags(this.pi, cwd, signal),
            apply: (tags) => {
                this.tagPickerController.refreshTags(tags);
                if (tags.some((tag) => tag.name === expectedTagName) && this.tagPickerController.state !== "closed") {
                    this.tagPickerController.showTagList();
                }
            },
        };
    }
    beginTagLoading(message, returnState) {
        this.tagLoadingReturnState = returnState;
        this.tagPickerController.state = "loading";
        this.loadingMessage = message;
        this.tagPickerController.loadingMessage = message;
        this.requestRender();
    }
    finishTagLoading() {
        this.loadingMessage = undefined;
        this.tagPickerController.loadingMessage = undefined;
        this.requestRender();
    }
    renderTagOverlay(baseLines, width) {
        return this.renderPickerOverlay(baseLines, width, (baseLineCount, overlayWidth) => this.tagPickerController.renderOverlayLines(baseLineCount, overlayWidth, this.theme));
    }
}
//# sourceMappingURL=viewer-tag-picker.js.map