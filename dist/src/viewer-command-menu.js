import { CommandMenuController } from "./command-menu-controller.js";
import { refreshWorkingTreeDocument, runGitCommand } from "./git.js";
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js";
export class DiffViewerCommandMenu extends DiffViewerCommitDialog {
    commandMenuController;
    constructor(...args) {
        super(...args);
        this.commandMenuController = new CommandMenuController({
            onRunCommand: (command) => {
                void this.runSelectedCommand(command).catch((error) => this.showAsyncError(error));
            },
            onClose: () => {
                this.commandMenuState = "closed";
            },
            onRequestRender: () => this.requestRender(),
        });
    }
    openCommandMenu() {
        this.error = undefined;
        this.statusMessage = undefined;
        this.commandMenuState = "open";
        this.commandMenuController.open();
    }
    handleCommandMenuInput(data) {
        if (this.commandMenuState === "loading") {
            return;
        }
        this.commandMenuController.handleInput(data);
    }
    async runSelectedCommand(command) {
        await this.runMutation("command", async (signal) => {
            const cwd = this.activePath();
            let disposition;
            this.commandMenuState = "loading";
            this.commandMenuController.state = "loading";
            this.loadingMessage = `Running ${command.label}…`;
            this.commandMenuController.loadingMessage = this.loadingMessage;
            this.error = undefined;
            this.statusMessage = undefined;
            this.requestRender();
            try {
                const message = await runGitCommand(this.pi, cwd, command, signal);
                disposition = await this.refreshDocumentAfterCommand(command.refresh.success, cwd, signal);
                if (disposition === "applied")
                    this.statusMessage = message;
            }
            catch (error) {
                if (this.setAsyncError(error)) {
                    disposition = await this.refreshDocumentAfterFailedCommand(command.refresh.failure, cwd, signal);
                }
            }
            finally {
                if (disposition !== "superseded") {
                    this.commandMenuState = "closed";
                    this.commandMenuController.state = "closed";
                    this.loadingMessage = undefined;
                    this.commandMenuController.loadingMessage = undefined;
                    this.requestRender();
                }
            }
        });
    }
    async refreshDocumentAfterCommand(scope, cwd, operationSignal) {
        const current = this.document;
        return this.loadLatestDocument({
            cwd,
            target: `working:${cwd}:${scope}`,
            selection: "preserve-current-path",
            load: async (signal) => {
                const result = await refreshWorkingTreeDocument(this.pi, this.contextFor(cwd, signal), current, scope);
                return result.document;
            },
            operationSignal,
        });
    }
    async refreshDocumentAfterFailedCommand(scope, cwd, operationSignal) {
        try {
            return await this.refreshDocumentAfterCommand(scope, cwd, operationSignal);
        }
        catch (refreshError) {
            const commandError = this.error;
            if (this.setAsyncError(refreshError)) {
                this.error = `${commandError}; refresh failed: ${this.error}`;
            }
            return "applied";
        }
    }
    renderCommandMenuOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.commandMenuController.renderOverlayLines(baseLines.length, width, this.theme);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
}
//# sourceMappingURL=viewer-command-menu.js.map