import {
  type ConfirmationPrompt,
  confirmationBodyLines,
  confirmationDecision,
  confirmationHint,
  discardConfirmationPrompt,
  initializationConfirmationPrompt,
} from "./confirmation-prompt.js"
import { discardFileChanges, initializeGitRepository } from "./git-extras.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import type { SingleLineTextField } from "./single-line-text-field.js"
import type { ConfirmAction, DiffFile, HelpContext } from "./types.js"
import { DiffViewerCommandMenu } from "./viewer-command-menu.js"

export class DiffViewerActions extends DiffViewerCommandMenu {
  protected confirmAction: ConfirmAction | undefined
  protected confirmFile: DiffFile | undefined
  protected confirmState: "closed" | "open" | "loading" = "closed"

  constructor(...args: ConstructorParameters<typeof DiffViewerCommandMenu>) {
    super(...args)
    this.featureOverlays.register({
      kind: "confirmation",
      adapter: {
        isActive: () => this.confirmState !== "closed",
        activeTextField: () => undefined,
        helpContext: () => "confirmDialog",
        render: (baseLines, width) => this.renderConfirmOverlay(baseLines, width),
        handleInput: (data) => this.handleConfirmInput(data),
        handleOpen: (data) => this.handleOpenInitDialogInput(data) || this.handleOpenDiscardDialogInput(data),
        close: () => this.closeConfirmDialog(),
      },
    })
  }

  protected override activeTextField(): SingleLineTextField | undefined {
    return this.featureOverlays.hasActive() ? this.featureOverlays.activeTextField() : super.activeTextField()
  }

  protected featureHelpContext(): HelpContext | undefined {
    return this.featureOverlays.helpContext()
  }

  protected hasFeatureOverlay(): boolean {
    return this.featureOverlays.hasActive()
  }

  protected renderFeatureOverlay(baseLines: string[], width: number): string[] {
    return this.featureOverlays.render(baseLines, width)
  }

  protected handleFeatureOverlayInput(data: string): boolean {
    return this.featureOverlays.handleInput(data)
  }

  protected handleFeatureOpenInput(data: string): boolean {
    return this.featureOverlays.handleOpen(data)
  }

  protected handleOpenInitDialogInput(data: string): boolean {
    if (data !== "I") {
      return false
    }
    if (!this.requireViewerAction("initialize")) {
      return true
    }
    if (!this.canStartForegroundOperation("initializing the repository")) {
      return true
    }
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
    this.confirmAction = "init"
    this.confirmFile = undefined
    this.confirmState = "open"
    this.requestRender()
    return true
  }

  protected handleOpenDiscardDialogInput(data: string): boolean {
    if (data !== "D") {
      return false
    }
    if (!this.requireViewerAction("discard")) {
      return true
    }
    if (!this.canStartForegroundOperation("discarding changes")) {
      return true
    }
    const file = this.files[this.selectedFileIndex]
    if (!file) {
      return true
    }
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
    this.confirmAction = "discard"
    this.confirmFile = file
    this.confirmState = "open"
    this.requestRender()
    return true
  }

  protected handleConfirmInput(data: string): void {
    const decision = confirmationDecision(data)
    if (decision === "cancel") {
      const wasLoading = this.confirmState === "loading"
      this.closeConfirmDialog()
      if (wasLoading) {
        this.cancelActiveOperation()
      }
      return
    }
    if (this.confirmState === "loading") {
      return
    }
    if (decision === "confirm") {
      this.runConfirmedAction().catch((error: unknown) => this.showAsyncError(error))
    }
  }

  protected closeConfirmDialog(): void {
    this.confirmState = "closed"
    this.confirmAction = undefined
    this.confirmFile = undefined
    this.loadingMessage = undefined
    this.requestRender()
  }

  protected async runConfirmedAction(): Promise<void> {
    const action = this.confirmAction
    const file = this.confirmFile
    const viewerAction = action === "init" ? "initialize" : "discard"
    if (!this.requireViewerAction(viewerAction)) {
      this.closeConfirmDialog()
      return
    }
    const cwd = this.activePath()
    const selection = this.documentState.captureSelection(file?.path)
    this.confirmState = "loading"
    this.loadingMessage = this.confirmLoadingMessage()
    this.requestRender()
    const outcome = await this.runMutation({
      label: action === "init" ? "initialize repository" : "discard changes",
      runningMessage: this.loadingMessage,
      mutate: ({ signal }) => this.executeConfirmedAction(action, file, cwd, signal),
      successMessage: (message) => message,
      refresh: this.workingTreeRefreshIntent(cwd, selection),
      reconcileOnFailure: true,
    })

    if (outcome.kind === "mutationFailed") {
      this.confirmAction = action
      this.confirmFile = file
      this.confirmState = "open"
    } else if (outcome.kind === "rejected") {
      this.confirmAction = action
      this.confirmFile = file
      this.confirmState = "open"
      this.showOperationRejection("confirm action")
    } else {
      this.confirmState = "closed"
      this.confirmAction = undefined
      this.confirmFile = undefined
    }
    this.loadingMessage = undefined
    this.requestRender()
  }

  protected executeConfirmedAction(
    action: ConfirmAction | undefined,
    file: DiffFile | undefined,
    cwd: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (action === "init") {
      return initializeGitRepository(this.pi, cwd, signal)
    }
    if (action === "discard" && file) {
      return discardFileChanges(this.pi, cwd, file, signal)
    }
    return Promise.reject(new Error("No confirmed action selected"))
  }

  protected confirmLoadingMessage(): string {
    return this.confirmAction === "init"
      ? "Initializing git repository…"
      : `Discarding ${this.confirmFile?.path ?? "file"}…`
  }

  protected renderConfirmOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const frame = createOverlayFrame(baseLines.length, width, this.theme)
    const prompt = this.confirmPrompt()
    const title = this.confirmState === "loading" ? (this.loadingMessage ?? "Working…") : prompt.title
    const hint = this.confirmState === "loading" ? "Esc: Cancel" : confirmationHint(prompt)
    const body =
      this.confirmState === "loading"
        ? [` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`]
        : confirmationBodyLines(prompt, this.theme, {
            compact: frame.compact,
            maxRows: frame.bodyRows,
            width: frame.innerWidth,
          })
    const overlay = renderOverlayFrame(
      frame,
      ` ${this.theme.fg("accent", this.theme.bold(title))}`,
      ` ${this.theme.fg("dim", hint)}`,
      body,
    )
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected confirmPrompt(): ConfirmationPrompt {
    return this.confirmAction === "init"
      ? initializationConfirmationPrompt(this.activePath())
      : discardConfirmationPrompt(this.confirmFile)
  }
}
