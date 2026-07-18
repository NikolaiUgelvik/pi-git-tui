import { matchesKey } from "@earendil-works/pi-tui"
import { CommitPickerController } from "./commit-picker-controller.js"
import { isBackspace } from "./filterable-list-state.js"
import { loadCommits } from "./git.js"
import type { SingleLineTextField } from "./single-line-text-field.js"
import type { CommitSummary } from "./types.js"
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js"

export class DiffViewerCommitPicker extends DiffViewerOverlayBase {
  protected commitPickerController: CommitPickerController
  private commitPickerRequest = 0

  constructor(...args: ConstructorParameters<typeof DiffViewerOverlayBase>) {
    super(...args)
    this.commitPickerController = new CommitPickerController({
      onSelectWorkingTree: () => {
        void this.selectWorkingTree().catch((error: unknown) => this.showAsyncError(error))
      },
      onSelectCommit: (commit: CommitSummary) => {
        void this.selectCommit(commit).catch((error: unknown) => this.showAsyncError(error))
      },
      onClose: () => {
        this.commitPickerRequest += 1
        this.pickerState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected override activeTextField(): SingleLineTextField | undefined {
    return this.pickerState === "open" ? this.commitPickerController.list.searchField : super.activeTextField()
  }

  protected async openCommitPicker(): Promise<void> {
    const requestId = ++this.commitPickerRequest
    const cwd = this.activePath()
    this.pickerState = "loading"
    this.commitPickerController.state = "loading"
    this.loadingMessage = "Loading commits…"
    this.commitPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    const outcome = await this.runLoad({
      label: "commit history",
      runningMessage: "Loading commits…",
      load: ({ signal }) => loadCommits(this.pi, cwd, signal),
      apply: (commits) => {
        if (requestId !== this.commitPickerRequest || this.pickerState === "closed") {
          return
        }
        this.pickerState = "open"
        this.commitPickerController.open(commits)
      },
    })
    if (requestId !== this.commitPickerRequest) {
      return
    }
    if (outcome.kind !== "succeeded") {
      this.pickerState = "closed"
      this.commitPickerController.state = "closed"
    }
    this.loadingMessage = undefined
    this.commitPickerController.loadingMessage = undefined
    this.requestRender()
  }

  protected handleCommitPickerInput(data: string): void {
    if (this.pickerState === "loading") {
      if (matchesKey(data, "escape")) {
        this.commitPickerRequest += 1
        this.pickerState = "closed"
        this.commitPickerController.state = "closed"
        this.loadingMessage = undefined
        this.commitPickerController.loadingMessage = undefined
        this.cancelActiveOperation()
        this.requestRender()
      }
      return
    }
    this.commitPickerController.handleInput(data)
  }

  protected override async returnToWorkingTree(): Promise<void> {
    if (!this.requireViewerAction("workingTree")) {
      return
    }
    const outcome = await this.loadDocument(
      { kind: "working", cwd: this.activePath() },
      {
        runningMessage: "Loading working tree…",
        successMessage: "Viewing working tree",
        recordFailure: true,
      },
    )
    if (outcome.kind === "succeeded") {
      this.error = undefined
      this.errorDetails = undefined
    }
    this.requestRender()
  }

  protected async selectWorkingTree(): Promise<void> {
    await this.selectDocument(
      { kind: "working", cwd: this.activePath() },
      "Loading working tree…",
      "Viewing working tree",
    )
  }

  protected async selectCommit(commit: CommitSummary): Promise<void> {
    await this.selectDocument(
      { kind: "commit", cwd: this.activePath(), commit },
      `Loading ${commit.hash}…`,
      `Viewing ${commit.hash}`,
    )
  }

  private async selectDocument(
    request: { kind: "working"; cwd: string } | { kind: "commit"; cwd: string; commit: CommitSummary },
    loadingMessage: string,
    successMessage: string,
  ): Promise<void> {
    const requestId = ++this.commitPickerRequest
    this.pickerState = "loading"
    this.commitPickerController.state = "loading"
    this.loadingMessage = loadingMessage
    this.commitPickerController.loadingMessage = loadingMessage
    this.requestRender()
    const outcome = await this.loadDocument(request, {
      runningMessage: loadingMessage,
      successMessage,
      recordFailure: true,
    })
    if (requestId !== this.commitPickerRequest) {
      return
    }
    this.pickerState = "closed"
    this.commitPickerController.state = "closed"
    this.loadingMessage = undefined
    this.commitPickerController.loadingMessage = undefined
    if (outcome.kind === "succeeded") {
      this.error = undefined
      this.errorDetails = undefined
    }
    this.requestRender()
  }

  protected renderCommitPickerOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected isBackspace(data: string): boolean {
    return isBackspace(data)
  }
}
