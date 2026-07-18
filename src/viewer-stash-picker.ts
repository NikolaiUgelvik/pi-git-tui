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

  protected override isOperationLoading(): boolean {
    return this.stashState === "loading" || super.isOperationLoading()
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
      if (!this.mutationActive()) {
        this.openStashPicker().catch((error: unknown) => this.showAsyncError(error))
      }
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
      const stashes = await listStashes(this.pi, this.activePath(), this.viewerSignal)
      this.stashState = "open"
      this.stashPickerController.open(stashes)
    } catch (error) {
      this.setAsyncError(error)
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
    await this.runStashOperation(
      "Stashing current changes…",
      (cwd, signal) => stashCurrentChanges(this.pi, cwd, signal),
      async (cwd, signal) => {
        const stashes = await listStashes(this.pi, cwd, signal)
        this.stashState = "open"
        this.stashPickerController.state = "open"
        this.stashPickerController.refreshStashes(stashes)
      },
    )
  }

  protected async runStashApply(ref: string): Promise<void> {
    await this.runStashOperation(
      `Applying ${ref}…`,
      (cwd, signal) => applyStash(this.pi, cwd, ref, signal),
      async () => {
        this.stashState = "closed"
        this.stashPickerController.state = "closed"
      },
    )
  }

  protected async runStashPop(ref: string): Promise<void> {
    await this.runStashOperation(
      `Popping ${ref}…`,
      (cwd, signal) => popStash(this.pi, cwd, ref, signal),
      async (cwd, signal) => {
        const stashes = await listStashes(this.pi, cwd, signal)
        this.stashState = "closed"
        this.stashPickerController.state = "closed"
        this.stashPickerController.refreshStashes(stashes)
      },
    )
  }

  protected async runStashDrop(ref: string): Promise<void> {
    await this.runStashOperation(
      `Dropping ${ref}…`,
      (cwd, signal) => dropStash(this.pi, cwd, ref, signal),
      async (cwd, signal) => {
        const stashes = await listStashes(this.pi, cwd, signal)
        this.stashState = "open"
        this.stashPickerController.state = "open"
        this.stashPickerController.stashConfirmAction = undefined
        this.stashPickerController.stashConfirmRef = ""
        this.stashPickerController.refreshStashes(stashes)
      },
    )
  }

  protected async runStashOperation(
    label: string,
    operation: (cwd: string, signal: AbortSignal) => Promise<string>,
    afterSuccess: (cwd: string, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    await this.runMutation("stash", async (signal) => {
      const cwd = this.activePath()
      let disposition: "applied" | "superseded" | undefined
      let documentApplied = false
      this.stashState = "loading"
      this.stashPickerController.state = "loading"
      this.loadingMessage = label
      this.stashPickerController.loadingMessage = this.loadingMessage
      this.error = undefined
      this.statusMessage = undefined
      this.requestRender()
      try {
        const message = await operation(cwd, signal)
        disposition = await this.loadLatestDocument({
          cwd,
          target: `working:${cwd}`,
          selection: "preserve-current-path",
          load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
          operationSignal: signal,
        })
        if (disposition === "applied") {
          documentApplied = true
          this.statusMessage = message
          await afterSuccess(cwd, signal)
        }
      } catch (error) {
        if (this.setAsyncError(error)) {
          if (!documentApplied) await this.refreshWorkingTreeAfterStashFailure(cwd, signal)
          this.stashState = "open"
          this.stashPickerController.state = "open"
        }
      } finally {
        if (disposition !== "superseded") {
          this.loadingMessage = undefined
          this.stashPickerController.loadingMessage = undefined
          this.requestRender()
        }
      }
    })
  }

  protected async refreshWorkingTreeAfterStashFailure(cwd: string, operationSignal: AbortSignal): Promise<void> {
    if (this.document.mode !== "working") return
    try {
      await this.loadLatestDocument({
        cwd,
        target: `working:${cwd}`,
        selection: "preserve-current-path",
        load: (signal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, signal)),
        operationSignal,
      })
    } catch (refreshError) {
      const stashError = this.error
      if (this.setAsyncError(refreshError)) {
        this.error = `${stashError}; refresh failed: ${this.error}`
      }
    }
  }

  protected renderStashOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.stashPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
