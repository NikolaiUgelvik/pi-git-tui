import { BranchPickerController } from "./branch-picker-controller.js"
import { loadWorkingTreeDiff } from "./git.js"
import { createAndSwitchBranch, listBranches, switchBranch } from "./git-extras.js"
import type { HelpContext } from "./types.js"
import { DiffViewerActions } from "./viewer-actions.js"

export class DiffViewerBranchPicker extends DiffViewerActions {
  protected branchState: "closed" | "loading" | "open" | "create" = "closed"
  protected branchPickerController: BranchPickerController

  constructor(...args: ConstructorParameters<typeof DiffViewerActions>) {
    super(...args)
    this.branchPickerController = new BranchPickerController({
      onSwitch: (name: string) => {
        void this.runBranchSwitch(name).catch((error: unknown) => this.showAsyncError(error))
      },
      onCreate: (name: string) => {
        void this.runBranchCreate(name).catch((error: unknown) => this.showAsyncError(error))
      },
      onValidationError: (message: string) => {
        this.error = message
        this.statusMessage = undefined
      },
      onClose: () => {
        this.branchState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.branchState !== "closed") {
      return "branchPicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.branchState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.branchState !== "closed") {
      return this.renderBranchOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.branchState !== "closed") {
      this.handleBranchInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "b") {
      this.openBranchPicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openBranchPicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before switching branches"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.branchState = "loading"
    this.branchPickerController.state = "loading"
    this.loadingMessage = "Loading branches…"
    this.branchPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      const branches = await listBranches(this.pi, this.activePath(), this.ctx.signal)
      this.branchState = "open"
      this.branchPickerController.open(branches)
    } catch (error) {
      this.branchState = "closed"
      this.branchPickerController.state = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.branchPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleBranchInput(data: string): void {
    if (this.branchState === "loading") {
      return
    }
    this.branchPickerController.handleInput(data)
  }

  protected async runBranchSwitch(name: string): Promise<void> {
    await this.runBranchOperation(`Switching to ${name}…`, "open", () =>
      switchBranch(this.pi, this.activePath(), name, this.ctx.signal),
    )
  }

  protected async runBranchCreate(name: string): Promise<void> {
    await this.runBranchOperation(`Creating ${name}…`, "create", () =>
      createAndSwitchBranch(this.pi, this.activePath(), name, this.ctx.signal),
    )
  }

  private async runBranchOperation(
    label: string,
    failureState: "open" | "create",
    operation: () => Promise<string>,
  ): Promise<void> {
    this.branchState = "loading"
    this.branchPickerController.state = "loading"
    this.loadingMessage = label
    this.branchPickerController.loadingMessage = label
    this.requestRender()
    try {
      this.statusMessage = await operation()
      this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
      this.branchState = "closed"
      this.branchPickerController.state = "closed"
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.branchState = failureState
      this.branchPickerController.state = failureState
    } finally {
      this.loadingMessage = undefined
      this.branchPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected renderBranchOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.branchPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
