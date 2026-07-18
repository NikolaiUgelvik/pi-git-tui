import { CommandMenuController } from "./command-menu-controller.js"
import { refreshWorkingTreeDocument, runGitCommand } from "./git.js"
import type { GitCommand, WorkingTreeRefreshScope } from "./types.js"
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js"

export class DiffViewerCommandMenu extends DiffViewerCommitDialog {
  protected commandMenuController: CommandMenuController

  constructor(...args: ConstructorParameters<typeof DiffViewerCommitDialog>) {
    super(...args)
    this.commandMenuController = new CommandMenuController({
      onRunCommand: (command: GitCommand) => {
        void this.runSelectedCommand(command).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.commandMenuState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected openCommandMenu(): void {
    this.error = undefined
    this.statusMessage = undefined
    this.commandMenuState = "open"
    this.commandMenuController.open()
  }

  protected handleCommandMenuInput(data: string): void {
    if (this.commandMenuState === "loading") {
      return
    }
    this.commandMenuController.handleInput(data)
  }

  protected async runSelectedCommand(command: GitCommand): Promise<void> {
    await this.runMutation("command", async (signal) => {
      const cwd = this.activePath()
      let disposition: "applied" | "superseded" | undefined
      this.commandMenuState = "loading"
      this.commandMenuController.state = "loading"
      this.loadingMessage = `Running ${command.label}…`
      this.commandMenuController.loadingMessage = this.loadingMessage
      this.error = undefined
      this.statusMessage = undefined
      this.requestRender()
      try {
        const message = await runGitCommand(this.pi, cwd, command, signal)
        disposition = await this.refreshDocumentAfterCommand(command.refresh.success, cwd, signal)
        if (disposition === "applied") this.statusMessage = message
      } catch (error) {
        if (this.setAsyncError(error)) {
          disposition = await this.refreshDocumentAfterFailedCommand(command.refresh.failure, cwd, signal)
        }
      } finally {
        if (disposition !== "superseded") {
          this.commandMenuState = "closed"
          this.commandMenuController.state = "closed"
          this.loadingMessage = undefined
          this.commandMenuController.loadingMessage = undefined
          this.requestRender()
        }
      }
    })
  }

  protected async refreshDocumentAfterCommand(
    scope: WorkingTreeRefreshScope,
    cwd: string,
    operationSignal: AbortSignal,
  ): Promise<"applied" | "superseded"> {
    const current = this.document
    return this.loadLatestDocument({
      cwd,
      target: `working:${cwd}:${scope}`,
      selection: "preserve-current-path",
      load: async (signal) => {
        const result = await refreshWorkingTreeDocument(this.pi, this.contextFor(cwd, signal), current, scope)
        return result.document
      },
      operationSignal,
    })
  }

  protected async refreshDocumentAfterFailedCommand(
    scope: WorkingTreeRefreshScope,
    cwd: string,
    operationSignal: AbortSignal,
  ): Promise<"applied" | "superseded"> {
    try {
      return await this.refreshDocumentAfterCommand(scope, cwd, operationSignal)
    } catch (refreshError) {
      const commandError = this.error
      if (this.setAsyncError(refreshError)) {
        this.error = `${commandError}; refresh failed: ${this.error}`
      }
      return "applied"
    }
  }

  protected renderCommandMenuOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commandMenuController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
