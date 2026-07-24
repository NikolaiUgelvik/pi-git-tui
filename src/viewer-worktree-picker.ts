import { matchesKey } from "@earendil-works/pi-tui"
import { listWorktrees, type WorktreeSummary } from "./git-extras.js"
import { DiffViewerStashPicker } from "./viewer-stash-picker.js"
import { WorktreePickerController } from "./worktree-picker-controller.js"

export class DiffViewerWorktreePicker extends DiffViewerStashPicker {
  protected worktreePickerController: WorktreePickerController
  protected worktreeState: "closed" | "loading" | "open" = "closed"
  private worktreeRequest = 0

  constructor(...args: ConstructorParameters<typeof DiffViewerStashPicker>) {
    super(...args)
    this.worktreePickerController = new WorktreePickerController({
      onSwitch: (worktree: WorktreeSummary) => {
        void this.switchToWorktree(worktree).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.worktreeRequest += 1
        this.worktreeState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
    this.featureOverlays.register("worktree", {
      isActive: () => this.worktreeState !== "closed",
      activeTextField: () =>
        this.worktreeState === "open" ? this.worktreePickerController.list.searchField : undefined,
      helpContext: () => "worktreePicker",
      render: (baseLines, width) => this.renderWorktreeOverlay(baseLines, width),
      handleInput: (data) => this.handleWorktreeInput(data),
      handleOpen: (data) => {
        if (data !== "w") {
          return false
        }
        if (this.requireViewerAction("worktrees") && this.canStartForegroundOperation("opening the worktree picker")) {
          this.openWorktreePicker().catch((error: unknown) => this.showAsyncError(error))
        }
        return true
      },
      close: () => this.worktreePickerController.close(),
    })
  }

  protected async openWorktreePicker(): Promise<void> {
    if (!this.requireViewerAction("worktrees")) {
      return
    }
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before switching worktrees"
      this.errorDetails = this.error
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    const requestId = ++this.worktreeRequest
    const cwd = this.activePath()
    this.worktreeState = "loading"
    this.worktreePickerController.state = "loading"
    this.loadingMessage = "Loading worktrees…"
    this.worktreePickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    const outcome = await this.runLoad({
      label: "worktrees",
      runningMessage: "Loading worktrees…",
      load: ({ signal }) => listWorktrees(this.pi, cwd, signal),
      apply: (worktrees) => {
        if (requestId !== this.worktreeRequest || this.worktreeState === "closed") {
          return
        }
        this.worktreeState = "open"
        this.worktreePickerController.open(worktrees, cwd)
      },
    })
    if (requestId !== this.worktreeRequest) {
      return
    }
    if (outcome.kind !== "succeeded") {
      this.worktreeState = "closed"
      this.worktreePickerController.state = "closed"
    }
    this.loadingMessage = undefined
    this.worktreePickerController.loadingMessage = undefined
    this.requestRender()
  }

  protected handleWorktreeInput(data: string): void {
    if (this.worktreeState === "loading") {
      if (matchesKey(data, "escape")) {
        this.worktreeRequest += 1
        this.worktreeState = "closed"
        this.worktreePickerController.state = "closed"
        this.loadingMessage = undefined
        this.worktreePickerController.loadingMessage = undefined
        this.cancelActiveOperation()
        this.requestRender()
      }
      return
    }
    this.worktreePickerController.handleInput(data)
  }

  protected async switchToWorktree(worktree: WorktreeSummary): Promise<void> {
    if (!this.requireViewerAction("worktrees")) {
      this.worktreeState = "closed"
      this.worktreePickerController.state = "closed"
      return
    }
    const requestId = ++this.worktreeRequest
    const selection = this.documentState.captureSelection()
    this.worktreeState = "loading"
    this.worktreePickerController.state = "loading"
    this.loadingMessage = `Loading ${worktree.path}…`
    this.worktreePickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    const outcome = await this.loadDocument(
      { kind: "working", cwd: worktree.path },
      {
        runningMessage: `Loading ${worktree.path}…`,
        successMessage: `Viewing ${worktree.path}`,
        selection,
      },
    )
    if (requestId !== this.worktreeRequest) {
      return
    }
    if (outcome.kind === "failed" || outcome.kind === "rejected") {
      this.worktreeState = "open"
      this.worktreePickerController.state = "open"
      if (outcome.kind === "rejected") {
        this.showOperationRejection("switch worktrees")
      }
    } else {
      this.worktreeState = "closed"
      this.worktreePickerController.state = "closed"
    }
    this.loadingMessage = undefined
    this.worktreePickerController.loadingMessage = undefined
    this.requestRender()
  }

  protected renderWorktreeOverlay(baseLines: string[], width: number): string[] {
    return this.renderPickerOverlay(baseLines, width, (baseLineCount, overlayWidth) =>
      this.worktreePickerController.renderOverlayLines(baseLineCount, overlayWidth, this.theme),
    )
  }
}
