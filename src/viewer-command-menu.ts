import { matchesKey } from "@earendil-works/pi-tui"
import { CommandMenuController } from "./command-menu-controller.js"
import { previewForcePush, runGitCommand } from "./git.js"
import type { SingleLineTextField } from "./single-line-text-field.js"
import type { GitCommand } from "./types.js"
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js"

export class DiffViewerCommandMenu extends DiffViewerCommitDialog {
  protected commandMenuController: CommandMenuController
  private commandMenuRequest = 0
  private commandPreviewPending = false

  constructor(...args: ConstructorParameters<typeof DiffViewerCommitDialog>) {
    super(...args)
    this.commandMenuController = new CommandMenuController({
      onRunCommand: (command: GitCommand) => {
        void this.runSelectedCommand(command).catch((error: unknown) => this.showAsyncError(error))
      },
      onPreviewForcePush: (command: GitCommand) => {
        void this.previewSelectedForcePush(command).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.commandMenuRequest += 1
        this.commandMenuState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected override activeTextField(): SingleLineTextField | undefined {
    return this.commandMenuState === "open" ? this.commandMenuController.list.searchField : super.activeTextField()
  }

  protected openCommandMenu(): void {
    if (!this.commandsAvailable()) {
      return
    }
    this.commandMenuRequest += 1
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
    this.commandMenuState = "open"
    this.commandMenuController.open()
  }

  protected handleCommandMenuInput(data: string): void {
    if (this.commandMenuState === "loading") {
      if (matchesKey(data, "escape")) {
        this.cancelCommandMenuLoad()
      }
      return
    }
    this.commandMenuController.handleInput(data)
    this.commandMenuState = this.commandMenuController.state
  }

  private cancelCommandMenuLoad(): void {
    this.commandMenuRequest += 1
    const returnToMenu = this.commandPreviewPending
    this.commandPreviewPending = false
    this.loadingMessage = undefined
    this.commandMenuController.loadingMessage = undefined
    this.cancelActiveOperation()
    if (returnToMenu) {
      this.commandMenuState = "open"
      this.commandMenuController.returnToMenu()
    } else {
      this.commandMenuState = "closed"
      this.commandMenuController.state = "closed"
    }
    this.requestRender()
  }

  protected async previewSelectedForcePush(command: GitCommand): Promise<void> {
    if (!this.commandsAvailable() || command.risk.kind !== "force-push") {
      this.commandMenuState = "open"
      this.commandMenuController.showPreviewFailure("Only force-push commands can be previewed")
      return
    }
    const requestId = ++this.commandMenuRequest
    const cwd = this.activePath()
    this.commandPreviewPending = true
    this.commandMenuState = "loading"
    this.commandMenuController.state = "loading"
    this.loadingMessage = "Resolving force-push destination…"
    this.commandMenuController.loadingMessage = this.loadingMessage
    this.requestRender()
    const outcome = await this.runLoad({
      label: "force-push preview",
      runningMessage: "Resolving force-push destination…",
      load: ({ signal }) => previewForcePush(this.pi, cwd, command, signal),
      apply: (preview) => {
        if (requestId !== this.commandMenuRequest || this.commandMenuState === "closed") {
          return
        }
        this.commandMenuState = "confirm"
        this.commandMenuController.showForcePushConfirmation(command, preview)
      },
    })
    if (requestId !== this.commandMenuRequest) {
      return
    }
    this.commandPreviewPending = false
    this.loadingMessage = undefined
    this.commandMenuController.loadingMessage = undefined
    if (outcome.kind === "failed") {
      this.commandMenuState = "open"
      this.retainFailureDetails(outcome.failure)
      this.commandMenuController.showPreviewFailure(outcome.failure.summary)
    } else if (outcome.kind !== "succeeded") {
      this.commandMenuState = "open"
      this.commandMenuController.returnToMenu()
    }
    this.requestRender()
  }

  protected async runSelectedCommand(command: GitCommand): Promise<void> {
    if (!this.commandsAvailable()) {
      this.closeCommandMenu()
      return
    }
    if (command.risk.kind === "force-push" && !this.forcePushWasConfirmed(command)) {
      this.commandMenuState = "open"
      this.commandMenuController.showPreviewFailure("Preview and confirm the force-push destination before pushing")
      return
    }
    const cwd = this.activePath()
    const successScope = command.refresh?.success ?? (command.refreshDiff ? "full" : "none")
    const failureScope = command.refresh?.failure ?? successScope
    const refresh = this.workingTreeRefreshIntent(cwd, this.documentState.captureSelection(), successScope)
    this.commandMenuState = "loading"
    this.commandMenuController.state = "loading"
    this.loadingMessage = `Running ${command.label}…`
    this.commandMenuController.loadingMessage = this.loadingMessage
    this.requestRender()
    const outcome = await this.runMutation({
      label: command.label,
      runningMessage: `Running ${command.label}…`,
      mutate: ({ signal }) => runGitCommand(this.pi, cwd, command, signal),
      successMessage: (message) => message,
      refresh,
      refreshAfterSuccess: successScope !== "none",
      reconcileOnFailure: failureScope !== "none",
    })

    if (outcome.kind === "mutationFailed") {
      this.error = outcome.failure.summary
      this.errorDetails = outcome.failure.details
      this.returnCommandMenuAfterFailure()
    } else if (outcome.kind === "rejected") {
      this.returnCommandMenuAfterFailure()
      this.showOperationRejection(`run ${command.label}`)
    } else {
      this.closeCommandMenu()
    }
    this.loadingMessage = undefined
    this.commandMenuController.loadingMessage = undefined
    this.requestRender()
  }

  private forcePushWasConfirmed(command: GitCommand): boolean {
    return (
      this.commandMenuController.pendingCommand === command && this.commandMenuController.forcePushPreview !== undefined
    )
  }

  private returnCommandMenuAfterFailure(): void {
    this.commandMenuState = "open"
    this.commandMenuController.returnToMenu()
  }

  private closeCommandMenu(): void {
    this.commandMenuRequest += 1
    this.commandPreviewPending = false
    this.commandMenuState = "closed"
    this.commandMenuController.state = "closed"
  }

  private commandsAvailable(): boolean {
    if (!this.requireViewerAction("commands")) {
      return false
    }
    if (!this.documentState.failure) {
      return true
    }
    this.error = "Reload the diff with r before running Git commands"
    this.errorDetails = this.documentState.failure.details
    this.statusMessage = undefined
    this.requestRender()
    return false
  }

  protected renderCommandMenuOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commandMenuController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
