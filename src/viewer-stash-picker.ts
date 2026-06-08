import { loadWorkingTreeDiff } from "./git.js"
import { applyStash, dropStash, listStashes, popStash, stashCurrentChanges } from "./git-extras.js"
import { StashPickerController } from "./stash-picker-controller.js"
import type { HelpContext } from "./types.js"
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js"

export class DiffViewerStashPicker extends DiffViewerBranchPicker {
  protected stashState: "closed" | "loading" | "open" | "confirm" = "closed"
  protected stashPickerController: StashPickerController

  constructor(...args: ConstructorParameters<typeof DiffViewerBranchPicker>) {
    super(...args)
    this.stashPickerController = new StashPickerController({
      onStashCurrent: () => {
        void this.runStashCurrent().catch((error: unknown) => this.showAsyncError(error))
      },
      onApply: (ref: string) => {
        void this.runStashApply(ref).catch((error: unknown) => this.showAsyncError(error))
      },
      onPop: (ref: string) => {
        void this.runStashPop(ref).catch((error: unknown) => this.showAsyncError(error))
      },
      onDrop: (ref: string) => {
        void this.runStashDrop(ref).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.stashState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.stashState !== "closed") {
      return "stashPicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.stashState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.stashState !== "closed") {
      return this.renderStashOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.stashState !== "closed") {
      this.handleStashInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "s") {
      this.openStashPicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openStashPicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before using stashes"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.stashState = "loading"
    this.stashPickerController.state = "loading"
    this.loadingMessage = "Loading stashes…"
    this.stashPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      const stashes = await listStashes(this.pi, this.activePath(), this.ctx.signal)
      this.stashState = "open"
      this.stashPickerController.open(stashes)
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.stashState = "closed"
      this.stashPickerController.state = "closed"
    } finally {
      this.loadingMessage = undefined
      this.stashPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleStashInput(data: string): void {
    if (this.stashState === "loading") {
      return
    }
    this.stashPickerController.handleInput(data)
  }

  protected async runStashCurrent(): Promise<void> {
    const succeeded = await this.runStashOperation("Stashing current changes…", () =>
      stashCurrentChanges(this.pi, this.activePath(), this.ctx.signal),
    )
    if (succeeded) {
      const stashes = await listStashes(this.pi, this.activePath(), this.ctx.signal)
      this.stashState = "open"
      this.stashPickerController.state = "open"
      this.stashPickerController.refreshStashes(stashes)
    }
  }

  protected async runStashApply(ref: string): Promise<void> {
    if (
      await this.runStashOperation(`Applying ${ref}…`, () =>
        applyStash(this.pi, this.activePath(), ref, this.ctx.signal),
      )
    ) {
      this.stashState = "closed"
      this.stashPickerController.state = "closed"
    }
  }

  protected async runStashPop(ref: string): Promise<void> {
    const succeeded = await this.runStashOperation(`Popping ${ref}…`, () =>
      popStash(this.pi, this.activePath(), ref, this.ctx.signal),
    )
    if (succeeded) {
      this.stashState = "closed"
      this.stashPickerController.state = "closed"
      const stashes = await listStashes(this.pi, this.activePath(), this.ctx.signal)
      this.stashPickerController.refreshStashes(stashes)
    }
  }

  protected async runStashDrop(ref: string): Promise<void> {
    const succeeded = await this.runStashOperation(`Dropping ${ref}…`, () =>
      dropStash(this.pi, this.activePath(), ref, this.ctx.signal),
    )
    if (succeeded) {
      this.stashState = "open"
      this.stashPickerController.state = "open"
      this.stashPickerController.stashConfirmAction = undefined
      this.stashPickerController.stashConfirmRef = ""
      const stashes = await listStashes(this.pi, this.activePath(), this.ctx.signal)
      this.stashPickerController.refreshStashes(stashes)
    }
  }

  protected async runStashOperation(label: string, operation: () => Promise<string>): Promise<boolean> {
    this.stashState = "loading"
    this.stashPickerController.state = "loading"
    this.loadingMessage = label
    this.stashPickerController.loadingMessage = this.loadingMessage
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      this.statusMessage = await operation()
      this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
      this.resetSelectionToFirstTreeFile()
      return true
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      await this.refreshWorkingTreeAfterStashFailure()
      this.stashState = "open"
      this.stashPickerController.state = "open"
      return false
    } finally {
      this.loadingMessage = undefined
      this.stashPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async refreshWorkingTreeAfterStashFailure(): Promise<void> {
    if (this.document.mode !== "working") {
      return
    }
    try {
      this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
      this.resetSelectionToFirstTreeFile()
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      this.error = `${this.error}; refresh failed: ${message}`
    }
  }

  protected renderStashOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.stashPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
