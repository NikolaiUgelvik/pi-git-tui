import { CommandMenuController } from "./command-menu-controller.js"
import { loadWorkingTreeDiff, runGitCommand } from "./git.js"
import type { GitCommand } from "./types.js"
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
    this.commandMenuState = "loading"
    this.commandMenuController.state = "loading"
    this.loadingMessage = `Running ${command.label}…`
    this.commandMenuController.loadingMessage = this.loadingMessage
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      const message = await runGitCommand(this.pi, this.activePath(), command, this.ctx.signal)
      await this.refreshDocumentAfterCommand(command)
      this.statusMessage = message
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      await this.refreshDocumentAfterFailedCommand(command)
    } finally {
      this.commandMenuState = "closed"
      this.commandMenuController.state = "closed"
      this.loadingMessage = undefined
      this.commandMenuController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async refreshDocumentAfterCommand(command: GitCommand): Promise<void> {
    if (!command.refreshDiff || this.document.mode !== "working") {
      return
    }
    this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
    this.resetSelectionToFirstTreeFile()
  }

  protected async refreshDocumentAfterFailedCommand(command: GitCommand): Promise<void> {
    try {
      await this.refreshDocumentAfterCommand(command)
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      this.error = `${this.error}; refresh failed: ${message}`
    }
  }

  protected renderCommandMenuOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commandMenuController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
