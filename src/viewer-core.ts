import { matchesKey } from "@earendil-works/pi-tui"
import { HelpOverlayState } from "./help-overlay-state.js"
import { fit } from "./render-text.js"
import type { SingleLineTextField } from "./single-line-text-field.js"
import type { HelpContext } from "./types.js"
import { commitReviewIntent } from "./viewer-index-policy.js"
import { isF1Input, isHelpCloseInput as isHelpCloseKey, isHelpKey as isHelpOpenKey } from "./viewer-key-input.js"
import { DiffViewerNavigationBase } from "./viewer-navigation-base.js"
import { ViewerOverlayCoordinator } from "./viewer-overlay-coordinator.js"

export class DiffViewerCore extends DiffViewerNavigationBase {
  protected commitAmend = false
  protected commitDialogState: "closed" | "loading" | "open" = "closed"
  protected commandMenuState: "closed" | "loading" | "open" | "confirm" = "closed"
  protected readonly helpOverlayState = new HelpOverlayState()
  protected readonly featureOverlays = new ViewerOverlayCoordinator()
  protected pickerState: "closed" | "loading" | "open" = "closed"

  protected get helpContext(): HelpContext | undefined {
    return this.helpOverlayState.context
  }

  protected handleHelpInput(data: string, allowPrintableShortcut = true): boolean {
    if (this.helpContext !== undefined) {
      if (this.isHelpCloseInput(data)) {
        this.helpOverlayState.close()
        this.requestRender()
      } else if (this.helpOverlayState.handleNavigation(data)) {
        this.requestRender()
      }
      return true
    }
    if (!this.isHelpKey(data) || (!allowPrintableShortcut && !isF1Input(data))) {
      return false
    }
    this.helpOverlayState.open(this.currentHelpContext())
    this.requestRender()
    return true
  }

  protected isHelpCloseInput(data: string): boolean {
    return isHelpCloseKey(data)
  }

  protected isHelpKey(data: string): boolean {
    return isHelpOpenKey(data)
  }

  protected currentHelpContext(): HelpContext {
    if (this.commitDialogState !== "closed") {
      return "commitDialog"
    }
    if (this.commandMenuState !== "closed") {
      return this.commandMenuState === "confirm" ? "confirmDialog" : "commandMenu"
    }
    if (this.pickerState !== "closed") {
      return "commitPicker"
    }
    return "viewer"
  }

  protected handleActiveOverlayInput(data: string): boolean {
    if (this.commitDialogState !== "closed") {
      this.handleCommitDialogInput(data)
      return true
    }
    if (this.commandMenuState !== "closed") {
      this.handleCommandMenuInput(data)
      return true
    }
    if (this.pickerState !== "closed") {
      this.handleCommitPickerInput(data)
      return true
    }
    return false
  }

  protected handleOperationCancelInput(data: string): boolean {
    if (!matchesKey(data, "escape") || !this.isOperationBusy()) {
      return false
    }
    this.cancelActiveOperation()
    return true
  }

  protected handleCloseInput(data: string): boolean {
    if (!this.isKey(data, "q") && !matchesKey(data, "escape")) {
      return false
    }
    if (this.isOperationBusy()) {
      this.error = "Press Escape to cancel the active operation before closing"
      this.errorDetails = this.error
      this.requestRender()
      return true
    }
    this.done()
    return true
  }

  protected handleOpenOverlayInput(data: string): boolean {
    const handlers = [
      () => this.handleReturnToWorkingTreeInput(data),
      () => this.handleOpenCommitDialogInput(data),
      () => this.handleOpenPickerInput(data),
      () => this.handleOpenCommandMenuInput(data),
    ]
    return handlers.some((handler) => handler())
  }

  protected handleOpenPickerInput(data: string): boolean {
    if (data !== "c") {
      return false
    }
    if (this.requireViewerAction("commitPicker") && this.canStartForegroundOperation("opening commit history")) {
      this.openCommitPicker().catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected handleReturnToWorkingTreeInput(data: string): boolean {
    if (data !== "W") {
      return false
    }
    if (this.document.mode === "working" && this.documentState.abandonFailedTarget()) {
      this.prepareOperation()
      this.statusMessage = "Viewing working tree"
      this.requestRender()
      return true
    }
    this.documentState.abandonFailedTarget()
    if (this.requireViewerAction("workingTree") && this.canStartForegroundOperation("returning to the working tree")) {
      this.returnToWorkingTree().catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected handleOpenCommitDialogInput(data: string): boolean {
    if (data !== "C") {
      return false
    }
    if (!this.requireViewerAction("commit")) {
      return true
    }
    const intent = commitReviewIntent(this.document, this.workingTreeView)
    if (intent.kind === "blocked") {
      this.error = intent.message
      this.errorDetails = intent.message
      this.statusMessage = undefined
      this.requestRender()
      return true
    }
    if (!this.canStartForegroundOperation("opening staged review")) {
      return true
    }
    if (intent.kind === "review") {
      this.documentState.setWorkingTreeView("staged")
      this.statusMessage = undefined
      this.error = undefined
      this.errorDetails = undefined
      this.requestRender()
      return true
    }
    this.openCommitDialog()
    return true
  }

  protected handleOpenCommandMenuInput(data: string): boolean {
    if (!matchesKey(data, "ctrl+p")) {
      return false
    }
    if (this.requireViewerAction("commands") && this.canStartForegroundOperation("opening the command menu")) {
      this.openCommandMenu()
    }
    return true
  }

  protected override showAsyncError(error: unknown): void {
    this.showUnexpectedError(error)
    this.featureOverlays.closeActive()
    this.pickerState = "closed"
    this.commandMenuState = "closed"
    this.commitDialogState = "closed"
  }

  protected renderOverlays(baseLines: string[], width: number): string[] {
    return baseLines.map((line) => fit(line, width))
  }

  protected activeTextField(): SingleLineTextField | undefined {
    return
  }

  protected returnToWorkingTree(): Promise<void> {
    return Promise.resolve()
  }

  protected handleCommitDialogInput(_data: string): void {}
  protected handleCommandMenuInput(_data: string): void {}
  protected handleCommitPickerInput(_data: string): void {}
  protected openCommitPicker(): Promise<void> {
    return Promise.resolve()
  }
  protected openCommitDialog(): void {}
  protected openCommandMenu(): void {}
}
