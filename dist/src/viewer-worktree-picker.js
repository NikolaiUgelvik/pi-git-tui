import { matchesKey } from "@earendil-works/pi-tui";
import { listWorktrees } from "./git-extras.js";
import { DiffViewerStashPicker } from "./viewer-stash-picker.js";
import { WorktreePickerController } from "./worktree-picker-controller.js";
export class DiffViewerWorktreePicker extends DiffViewerStashPicker {
    worktreePickerController;
    constructor(...args) {
        super(...args);
        this.worktreePickerController = new WorktreePickerController({
            onSwitch: (worktree) => {
                void this.switchToWorktree(worktree).catch((error) => this.showAsyncError(error));
            },
            onClose: () => this.cancelActiveOperation(),
            onRequestRender: () => this.requestRender(),
        });
        this.featureOverlays.register({
            kind: "worktree",
            adapter: {
                isActive: () => this.worktreePickerController.state !== "closed",
                activeTextField: () => this.worktreePickerController.state === "open" ? this.worktreePickerController.list.searchField : undefined,
                helpContext: () => "worktreePicker",
                render: (baseLines, width) => this.renderWorktreeOverlay(baseLines, width),
                handleInput: (data) => this.handleWorktreeInput(data),
                handleOpen: (data) => {
                    if (data !== "w")
                        return false;
                    if (this.requireViewerAction("worktrees") &&
                        this.canStartForegroundOperation("opening the worktree picker")) {
                        void this.openWorktreePicker().catch((error) => this.showAsyncError(error));
                    }
                    return true;
                },
                close: () => this.worktreePickerController.close(),
            },
        });
    }
    async openWorktreePicker() {
        if (!this.requireViewerAction("worktrees"))
            return;
        if (this.document.repositoryState === "missing") {
            this.error = "Initialize a git repository before switching worktrees";
            this.errorDetails = this.error;
            this.statusMessage = undefined;
            this.requestRender();
            return;
        }
        const cwd = this.activePath();
        const request = this.worktreePickerController.beginLoading("Loading worktrees…", "closed");
        this.requestRender();
        const outcome = await this.runLoad({
            label: "worktrees",
            runningMessage: "Loading worktrees…",
            load: ({ signal }) => listWorktrees(this.pi, cwd, signal),
            apply: (worktrees) => {
                if (this.worktreePickerController.isCurrent(request))
                    this.worktreePickerController.open(worktrees, cwd);
            },
        });
        if (!this.worktreePickerController.isCurrent(request))
            return;
        this.worktreePickerController.finishLoading(request, outcome.kind === "succeeded" ? "open" : "closed");
        this.requestRender();
    }
    handleWorktreeInput(data) {
        if (this.worktreePickerController.state === "loading") {
            if (matchesKey(data, "escape")) {
                this.worktreePickerController.close();
                this.requestRender();
            }
            return;
        }
        this.worktreePickerController.handleInput(data);
    }
    async switchToWorktree(worktree) {
        if (!this.requireViewerAction("worktrees")) {
            this.worktreePickerController.close();
            return;
        }
        const request = this.worktreePickerController.beginLoading(`Loading ${worktree.path}…`, "open");
        const selection = this.documentState.captureSelection();
        this.requestRender();
        const outcome = await this.loadDocument({ kind: "working", cwd: worktree.path }, {
            runningMessage: `Loading ${worktree.path}…`,
            successMessage: `Viewing ${worktree.path}`,
            selection,
        });
        if (!this.worktreePickerController.isCurrent(request))
            return;
        const failed = outcome.kind === "failed" || outcome.kind === "rejected";
        this.worktreePickerController.finishLoading(request, failed ? "open" : "closed");
        if (outcome.kind === "rejected")
            this.showOperationRejection("switch worktrees");
        this.requestRender();
    }
    renderWorktreeOverlay(baseLines, width) {
        return this.renderPickerOverlay(baseLines, width, (baseLineCount, overlayWidth) => this.worktreePickerController.renderOverlayLines(baseLineCount, overlayWidth, this.theme));
    }
}
//# sourceMappingURL=viewer-worktree-picker.js.map