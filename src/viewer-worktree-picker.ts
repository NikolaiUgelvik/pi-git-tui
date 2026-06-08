import { loadWorkingTreeDiff } from "./git.js"
import { listWorktrees, type WorktreeSummary } from "./git-extras.js"
import type { HelpContext } from "./types.js"
import { DiffViewerStashPicker } from "./viewer-stash-picker.js"
import { WorktreePickerController } from "./worktree-picker-controller.js"

export class DiffViewerWorktreePicker extends DiffViewerStashPicker {
  protected worktreeState: "closed" | "loading" | "open" = "closed"
  protected worktreePickerController: WorktreePickerController

  constructor(...args: ConstructorParameters<typeof DiffViewerStashPicker>) {
    super(...args)
    this.worktreePickerController = new WorktreePickerController({
      onSwitch: (worktree: WorktreeSummary) => {
        void this.switchToWorktree(worktree).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.worktreeState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.worktreeState !== "closed") {
      return "worktreePicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.worktreeState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.worktreeState !== "closed") {
      return this.renderWorktreeOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.worktreeState !== "closed") {
      this.handleWorktreeInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "w") {
      this.openWorktreePicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openWorktreePicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before switching worktrees"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.worktreeState = "loading"
    this.worktreePickerController.state = "loading"
    this.loadingMessage = "Loading worktrees…"
    this.worktreePickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      const worktrees = await listWorktrees(this.pi, this.activePath(), this.ctx.signal)
      this.worktreeState = "open"
      this.worktreePickerController.open(worktrees, this.activePath())
    } catch (error) {
      this.worktreeState = "closed"
      this.worktreePickerController.state = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.worktreePickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleWorktreeInput(data: string): void {
    if (this.worktreeState === "loading") {
      return
    }
    this.worktreePickerController.handleInput(data)
  }

  protected async switchToWorktree(worktree: WorktreeSummary): Promise<void> {
    const previousPath = this.activePath()
    this.worktreeState = "loading"
    this.worktreePickerController.state = "loading"
    this.loadingMessage = `Loading ${worktree.path}…`
    this.worktreePickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      this.activeCwd = worktree.path
      this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
      this.statusMessage = `Viewing ${worktree.path}`
      this.worktreeState = "closed"
      this.worktreePickerController.state = "closed"
    } catch (error) {
      this.activeCwd = previousPath
      this.error = error instanceof Error ? error.message : String(error)
      this.worktreeState = "open"
      this.worktreePickerController.state = "open"
    } finally {
      this.loadingMessage = undefined
      this.worktreePickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected renderWorktreeOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.worktreePickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
