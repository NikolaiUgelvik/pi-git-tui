import { matchesKey } from "@earendil-works/pi-tui";
import { CommandMenuController } from "./command-menu-controller.js";
import { previewForcePush, runGitCommand } from "./git.js";
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js";
export class DiffViewerCommandMenu extends DiffViewerCommitDialog {
    commandMenuController;
    commandMenuRequest = 0;
    commandPreviewPending = false;
    constructor(...args) {
        super(...args);
        this.commandMenuController = new CommandMenuController({
            onRunCommand: (command) => {
                void this.runSelectedCommand(command).catch((error) => this.showAsyncError(error));
            },
            onPreviewForcePush: (command) => {
                void this.previewSelectedForcePush(command).catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                this.commandMenuRequest += 1;
                this.commandMenuState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    activeTextField() {
        return this.commandMenuState === "open" ? this.commandMenuController.list.searchField : super.activeTextField();
    }
    openCommandMenu() {
        if (!this.commandsAvailable()) {
            return;
        }
        this.commandMenuRequest += 1;
        this.error = undefined;
        this.errorDetails = undefined;
        this.statusMessage = undefined;
        this.commandMenuState = "open";
        this.commandMenuController.open();
    }
    handleCommandMenuInput(data) {
        if (this.commandMenuState === "loading") {
            if (matchesKey(data, "escape")) {
                this.cancelCommandMenuLoad();
            }
            return;
        }
        this.commandMenuController.handleInput(data);
        this.commandMenuState = this.commandMenuController.state;
    }
    cancelCommandMenuLoad() {
        this.commandMenuRequest += 1;
        const returnToMenu = this.commandPreviewPending;
        this.commandPreviewPending = false;
        this.loadingMessage = undefined;
        this.commandMenuController.loadingMessage = undefined;
        this.cancelActiveOperation();
        if (returnToMenu) {
            this.commandMenuState = "open";
            this.commandMenuController.returnToMenu();
        }
        else {
            this.commandMenuState = "closed";
            this.commandMenuController.state = "closed";
        }
        this.requestRender();
    }
    async previewSelectedForcePush(command) {
        if (!this.commandsAvailable() || command.risk.kind !== "force-push") {
            this.commandMenuState = "open";
            this.commandMenuController.showPreviewFailure("Only force-push commands can be previewed");
            return;
        }
        const requestId = ++this.commandMenuRequest;
        const cwd = this.activePath();
        this.commandPreviewPending = true;
        this.commandMenuState = "loading";
        this.commandMenuController.state = "loading";
        this.loadingMessage = "Resolving force-push destination…";
        this.commandMenuController.loadingMessage = this.loadingMessage;
        this.requestRender();
        const outcome = await this.runLoad({
            label: "force-push preview",
            runningMessage: "Resolving force-push destination…",
            load: ({ signal }) => previewForcePush(this.pi, cwd, command, signal),
            apply: (preview) => {
                if (requestId !== this.commandMenuRequest || this.commandMenuState === "closed") {
                    return;
                }
                this.commandMenuState = "confirm";
                this.commandMenuController.showForcePushConfirmation(command, preview);
            },
        });
        if (requestId !== this.commandMenuRequest) {
            return;
        }
        this.commandPreviewPending = false;
        this.loadingMessage = undefined;
        this.commandMenuController.loadingMessage = undefined;
        if (outcome.kind === "failed") {
            this.commandMenuState = "open";
            this.retainFailureDetails(outcome.failure);
            this.commandMenuController.showPreviewFailure(outcome.failure.summary);
        }
        else if (outcome.kind !== "succeeded") {
            this.commandMenuState = "open";
            this.commandMenuController.returnToMenu();
        }
        this.requestRender();
    }
    async runSelectedCommand(command) {
        if (!this.commandsAvailable()) {
            this.closeCommandMenu();
            return;
        }
        if (command.risk.kind === "force-push" && !this.forcePushWasConfirmed(command)) {
            this.commandMenuState = "open";
            this.commandMenuController.showPreviewFailure("Preview and confirm the force-push destination before pushing");
            return;
        }
        const cwd = this.activePath();
        const successScope = command.refresh?.success ?? (command.refreshDiff ? "full" : "none");
        const failureScope = command.refresh?.failure ?? successScope;
        const refresh = this.workingTreeRefreshIntent(cwd, this.documentState.captureSelection(), successScope);
        this.commandMenuState = "loading";
        this.commandMenuController.state = "loading";
        this.loadingMessage = `Running ${command.label}…`;
        this.commandMenuController.loadingMessage = this.loadingMessage;
        this.requestRender();
        const outcome = await this.runMutation({
            label: command.label,
            runningMessage: `Running ${command.label}…`,
            mutate: ({ signal }) => runGitCommand(this.pi, cwd, command, signal),
            successMessage: (message) => message,
            refresh,
            refreshAfterSuccess: successScope !== "none",
            reconcileOnFailure: failureScope !== "none",
        });
        if (outcome.kind === "mutationFailed") {
            this.error = outcome.failure.summary;
            this.errorDetails = outcome.failure.details;
            this.returnCommandMenuAfterFailure();
        }
        else if (outcome.kind === "rejected") {
            this.returnCommandMenuAfterFailure();
            this.showOperationRejection(`run ${command.label}`);
        }
        else {
            this.closeCommandMenu();
        }
        this.loadingMessage = undefined;
        this.commandMenuController.loadingMessage = undefined;
        this.requestRender();
    }
    forcePushWasConfirmed(command) {
        return (this.commandMenuController.pendingCommand === command && this.commandMenuController.forcePushPreview !== undefined);
    }
    returnCommandMenuAfterFailure() {
        this.commandMenuState = "open";
        this.commandMenuController.returnToMenu();
    }
    closeCommandMenu() {
        this.commandMenuRequest += 1;
        this.commandPreviewPending = false;
        this.commandMenuState = "closed";
        this.commandMenuController.state = "closed";
    }
    commandsAvailable() {
        if (!this.requireViewerAction("commands")) {
            return false;
        }
        if (!this.documentState.failure) {
            return true;
        }
        this.error = "Reload the diff with r before running Git commands";
        this.errorDetails = this.documentState.failure.details;
        this.statusMessage = undefined;
        this.requestRender();
        return false;
    }
    renderCommandMenuOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.commandMenuController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-command-menu.js.map