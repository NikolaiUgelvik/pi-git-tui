import { matchesKey } from "@earendil-works/pi-tui";
import { CommitPickerController } from "./commit-picker-controller.js";
import { isBackspace } from "./filterable-list-state.js";
import { loadCommits } from "./git.js";
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js";
export class DiffViewerCommitPicker extends DiffViewerOverlayBase {
    commitPickerController;
    commitPickerRequest = 0;
    constructor(...args) {
        super(...args);
        this.commitPickerController = new CommitPickerController({
            onSelectWorkingTree: () => {
                void this.selectWorkingTree().catch((error) => this.showAsyncError(error));
            },
            onSelectCommit: (commit) => {
                void this.selectCommit(commit).catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                this.commitPickerRequest += 1;
                this.pickerState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    activeTextField() {
        return this.pickerState === "open" ? this.commitPickerController.list.searchField : super.activeTextField();
    }
    async openCommitPicker() {
        const requestId = ++this.commitPickerRequest;
        const cwd = this.activePath();
        this.pickerState = "loading";
        this.commitPickerController.state = "loading";
        this.loadingMessage = "Loading commits…";
        this.commitPickerController.loadingMessage = this.loadingMessage;
        this.requestRender();
        const outcome = await this.runLoad({
            label: "commit history",
            runningMessage: "Loading commits…",
            load: ({ signal }) => loadCommits(this.pi, cwd, signal),
            apply: (commits) => {
                if (requestId !== this.commitPickerRequest || this.pickerState === "closed") {
                    return;
                }
                this.pickerState = "open";
                this.commitPickerController.open(commits);
            },
        });
        if (requestId !== this.commitPickerRequest) {
            return;
        }
        if (outcome.kind !== "succeeded") {
            this.pickerState = "closed";
            this.commitPickerController.state = "closed";
        }
        this.loadingMessage = undefined;
        this.commitPickerController.loadingMessage = undefined;
        this.requestRender();
    }
    handleCommitPickerInput(data) {
        if (this.pickerState === "loading") {
            if (matchesKey(data, "escape")) {
                this.commitPickerRequest += 1;
                this.pickerState = "closed";
                this.commitPickerController.state = "closed";
                this.loadingMessage = undefined;
                this.commitPickerController.loadingMessage = undefined;
                this.cancelActiveOperation();
                this.requestRender();
            }
            return;
        }
        this.commitPickerController.handleInput(data);
    }
    async returnToWorkingTree() {
        if (!this.requireViewerAction("workingTree")) {
            return;
        }
        const outcome = await this.loadDocument({ kind: "working", cwd: this.activePath() }, {
            runningMessage: "Loading working tree…",
            successMessage: "Viewing working tree",
            recordFailure: true,
        });
        if (outcome.kind === "succeeded") {
            this.error = undefined;
            this.errorDetails = undefined;
        }
        this.requestRender();
    }
    async selectWorkingTree() {
        await this.selectDocument({ kind: "working", cwd: this.activePath() }, "Loading working tree…", "Viewing working tree");
    }
    async selectCommit(commit) {
        await this.selectDocument({ kind: "commit", cwd: this.activePath(), commit }, `Loading ${commit.hash}…`, `Viewing ${commit.hash}`);
    }
    async selectDocument(request, loadingMessage, successMessage) {
        const requestId = ++this.commitPickerRequest;
        this.pickerState = "loading";
        this.commitPickerController.state = "loading";
        this.loadingMessage = loadingMessage;
        this.commitPickerController.loadingMessage = loadingMessage;
        this.requestRender();
        const outcome = await this.loadDocument(request, {
            runningMessage: loadingMessage,
            successMessage,
            recordFailure: true,
        });
        if (requestId !== this.commitPickerRequest) {
            return;
        }
        this.pickerState = "closed";
        this.commitPickerController.state = "closed";
        this.loadingMessage = undefined;
        this.commitPickerController.loadingMessage = undefined;
        if (outcome.kind === "succeeded") {
            this.error = undefined;
            this.errorDetails = undefined;
        }
        this.requestRender();
    }
    renderCommitPickerOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.commitPickerController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
    isBackspace(data) {
        return isBackspace(data);
    }
}
//# sourceMappingURL=viewer-commit-picker.js.map