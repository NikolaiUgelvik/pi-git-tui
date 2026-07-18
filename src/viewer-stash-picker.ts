import { applyStash, dropStash, listStashes, popStash, stashCurrentChanges } from "./git-extras.js"
import { StashPickerController } from "./stash-picker-controller.js"
import type { StashSummary } from "./types.js"
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js"
import type { LoadOutcome, MutationOutcome } from "./viewer-operation-coordinator.js"

export class DiffViewerStashPicker extends DiffViewerBranchPicker {
  protected stashPickerController: StashPickerController
  protected stashState: "closed" | "loading" | "open" | "confirm" = "closed"
  private stashListRequest = 0
  private stashMutationFeedback: string | undefined

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
      onRetryList: () => {
        void this.retryStashList().catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        const wasLoading = this.stashState === "loading"
        this.stashListRequest += 1
        this.stashState = "closed"
        this.loadingMessage = undefined
        this.stashPickerController.loadingMessage = undefined
        this.restoreStashMutationFeedback()
        if (wasLoading) {
          this.cancelActiveOperation()
        }
      },
      onRequestRender: () => this.requestRender(),
    })
    this.featureOverlays.register("stash", {
      isActive: () => this.stashPickerController.state !== "closed",
      activeTextField: () =>
        this.stashPickerController.state === "open" ? this.stashPickerController.list.searchField : undefined,
      helpContext: () => (this.stashPickerController.state === "confirm" ? "confirmDialog" : "stashPicker"),
      render: (baseLines, width) => this.renderStashOverlay(baseLines, width),
      handleInput: (data) => this.handleStashInput(data),
      handleOpen: (data) => {
        if (data !== "s") {
          return false
        }
        if (this.requireViewerAction("stashes") && this.canStartForegroundOperation("opening the stash picker")) {
          this.openStashPicker().catch((error: unknown) => this.showAsyncError(error))
        }
        return true
      },
      close: () => this.stashPickerController.close(),
    })
  }

  protected async openStashPicker(): Promise<void> {
    if (!this.requireViewerAction("stashes")) {
      return
    }
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before using stashes"
      this.errorDetails = this.error
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    await this.loadStashList("open")
  }

  protected handleStashInput(data: string): void {
    this.stashPickerController.handleInput(data)
    this.stashState = this.stashPickerController.state
  }

  protected async runStashCurrent(): Promise<void> {
    const outcome = await this.runStashOperation("Stashing current changes…", (cwd, signal) =>
      stashCurrentChanges(this.pi, cwd, signal),
    )
    if (outcome.kind === "succeeded") {
      await this.loadStashList("refresh", outcome.mutation)
    } else if (outcome.kind === "refreshFailed") {
      this.closeStashAfterMutation()
    }
  }

  protected async runStashApply(ref: string): Promise<void> {
    const outcome = await this.runStashOperation(`Applying ${ref}…`, (cwd, signal) =>
      applyStash(this.pi, cwd, ref, signal),
    )
    if (outcome.kind === "succeeded" || outcome.kind === "refreshFailed") {
      this.closeStashAfterMutation()
    }
  }

  protected async runStashPop(ref: string): Promise<void> {
    const outcome = await this.runStashOperation(`Popping ${ref}…`, (cwd, signal) =>
      popStash(this.pi, cwd, ref, signal),
    )
    if (outcome.kind === "succeeded" || outcome.kind === "refreshFailed") {
      this.closeStashAfterMutation()
    }
  }

  protected async runStashDrop(ref: string): Promise<void> {
    const outcome = await this.runStashOperation(`Dropping ${ref}…`, (cwd, signal) =>
      dropStash(this.pi, cwd, ref, signal),
    )
    if (outcome.kind === "succeeded") {
      this.stashPickerController.clearStashConfirmation()
      await this.loadStashList("refresh", outcome.mutation)
    } else if (outcome.kind === "refreshFailed") {
      this.closeStashAfterMutation()
    }
  }

  protected async runStashOperation(
    label: string,
    operation: (cwd: string, signal: AbortSignal) => Promise<string>,
  ): Promise<MutationOutcome<string>> {
    if (!this.requireViewerAction("stashes")) {
      this.closeStashAfterMutation()
      return { kind: "rejected", reason: "busy" }
    }
    const cwd = this.activePath()
    const selection = this.documentState.captureSelection()
    this.stashState = "loading"
    this.stashPickerController.state = "loading"
    this.loadingMessage = label
    this.stashPickerController.loadingMessage = label
    this.requestRender()
    try {
      const outcome = await this.runMutation({
        label: "stash operation",
        runningMessage: label,
        mutate: ({ signal }) => operation(cwd, signal),
        successMessage: (message) => message,
        refresh: this.workingTreeRefreshIntent(cwd, selection),
        reconcileOnFailure: true,
      })

      if (outcome.kind === "rejected") {
        this.showOperationRejection("run a stash operation")
      }
      if (outcome.kind === "cancelled" || outcome.kind === "stale") {
        this.closeStashAfterMutation()
      } else {
        this.stashState = "open"
        this.stashPickerController.state = "open"
      }
      return outcome
    } finally {
      if (this.stashState === "loading") {
        this.stashState = "open"
        this.stashPickerController.state = "open"
      }
      this.loadingMessage = undefined
      this.stashPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  private async retryStashList(): Promise<void> {
    if (!this.requireViewerAction("stashes") || !this.canStartForegroundOperation("retrying the stash list")) {
      return
    }
    await this.loadStashList("refresh", this.statusMessage)
  }

  private async loadStashList(mode: "open" | "refresh", retainedSuccess?: string): Promise<void> {
    const requestId = ++this.stashListRequest
    const cwd = this.activePath()
    if (mode === "open") {
      this.stashMutationFeedback = undefined
    } else if (retainedSuccess) {
      this.stashMutationFeedback = retainedSuccess
    }
    this.beginStashListLoad(mode)
    try {
      const loading = this.runLoad<StashSummary[]>({
        label: "stash list",
        runningMessage: this.loadingMessage ?? "Loading stashes…",
        load: ({ signal }) => listStashes(this.pi, cwd, signal),
        apply: (stashes) => this.applyStashList(requestId, mode, stashes),
        reportFailure: mode === "open",
      })
      this.restoreStashMutationFeedback()
      const outcome = await loading
      this.restoreStashMutationFeedback()
      if (requestId === this.stashListRequest) {
        this.applyStashListOutcome(mode, outcome, retainedSuccess)
      }
    } finally {
      this.restoreStashMutationFeedback()
      this.finishStashListLoad(requestId, mode)
      this.requestRender()
    }
  }

  private beginStashListLoad(mode: "open" | "refresh"): void {
    this.stashState = "loading"
    this.stashPickerController.state = "loading"
    this.loadingMessage = mode === "open" ? "Loading stashes…" : "Refreshing stashes…"
    this.stashPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
  }

  private applyStashList(requestId: number, mode: "open" | "refresh", stashes: StashSummary[]): void {
    if (requestId !== this.stashListRequest || this.stashState === "closed") {
      return
    }
    this.stashState = "open"
    if (mode === "open") {
      this.stashPickerController.open(stashes)
      return
    }
    this.stashPickerController.state = "open"
    this.stashPickerController.refreshStashes(stashes)
  }

  private applyStashListOutcome(
    mode: "open" | "refresh",
    outcome: LoadOutcome<StashSummary[]>,
    retainedSuccess?: string,
  ): void {
    if (outcome.kind === "failed" && mode === "refresh") {
      this.stashState = "open"
      this.stashPickerController.state = "open"
      this.retainFailureDetails(outcome.failure)
      this.stashPickerController.showListWarning(`Stash list refresh failed: ${outcome.failure.summary}`)
    } else if (outcome.kind !== "succeeded") {
      this.stashState = "closed"
      this.stashPickerController.state = "closed"
    }
    if (retainedSuccess) {
      this.statusMessage = retainedSuccess
    }
  }

  private finishStashListLoad(requestId: number, mode: "open" | "refresh"): void {
    if (requestId !== this.stashListRequest) {
      return
    }
    if (this.stashState === "loading") {
      this.stashState = mode === "refresh" ? "open" : "closed"
      this.stashPickerController.state = this.stashState
    }
    this.loadingMessage = undefined
    this.stashPickerController.loadingMessage = undefined
    this.requestRender()
  }

  private restoreStashMutationFeedback(): void {
    if (this.stashMutationFeedback) {
      this.statusMessage = this.stashMutationFeedback
    }
  }

  private closeStashAfterMutation(): void {
    this.stashListRequest += 1
    this.stashState = "closed"
    this.stashPickerController.state = "closed"
  }

  protected renderStashOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.stashPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }
}
