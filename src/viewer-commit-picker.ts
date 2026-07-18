import { CommitPickerController } from "./commit-picker-controller.js"
import { isBackspace } from "./filterable-list-state.js"
import { loadCommitDiff, loadCommits, loadWorkingTreeDiff } from "./git.js"
import type { CommitSummary } from "./types.js"
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js"

export class DiffViewerCommitPicker extends DiffViewerOverlayBase {
  protected commitPickerController: CommitPickerController

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
        this.pickerState = "closed"
      },
      onRequestRender: () => this.requestRender(),
    })
  }

  protected async openCommitPicker(): Promise<void> {
    this.error = undefined
    this.pickerState = "loading"
    this.commitPickerController.state = "loading"
    this.loadingMessage = "Loading commits…"
    this.commitPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      const commits = await loadCommits(this.pi, this.activePath(), this.viewerSignal)
      this.pickerState = "open"
      this.commitPickerController.open(commits)
    } catch (error) {
      this.pickerState = "closed"
      this.commitPickerController.state = "closed"
      this.setAsyncError(error)
    } finally {
      this.loadingMessage = undefined
      this.commitPickerController.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleCommitPickerInput(data: string): void {
    if (this.pickerState === "loading") {
      return
    }
    this.commitPickerController.handleInput(data)
  }

  protected async selectWorkingTree(): Promise<void> {
    if (this.mutationActive()) return
    const cwd = this.activePath()
    let disposition: "applied" | "superseded" | undefined
    this.pickerState = "loading"
    this.commitPickerController.state = "loading"
    this.loadingMessage = "Loading working tree…"
    this.commitPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      disposition = await this.loadLatestDocument({
        cwd,
        target: `working:${cwd}`,
        selection: "first",
        load: (signal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, signal)),
      })
      if (disposition === "applied") this.error = undefined
    } catch (error) {
      this.setAsyncError(error)
    } finally {
      if (disposition !== "superseded") {
        this.pickerState = "closed"
        this.commitPickerController.state = "closed"
        this.loadingMessage = undefined
        this.commitPickerController.loadingMessage = undefined
        this.requestRender()
      }
    }
  }

  protected async selectCommit(commit: CommitSummary): Promise<void> {
    if (this.mutationActive()) return
    const cwd = this.activePath()
    let disposition: "applied" | "superseded" | undefined
    this.pickerState = "loading"
    this.commitPickerController.state = "loading"
    this.loadingMessage = `Loading ${commit.hash}…`
    this.commitPickerController.loadingMessage = this.loadingMessage
    this.requestRender()
    try {
      disposition = await this.loadLatestDocument({
        cwd,
        target: `commit:${cwd}:${commit.hash}`,
        selection: "first",
        load: (signal) => loadCommitDiff(this.pi, cwd, commit, signal),
      })
      if (disposition === "applied") this.error = undefined
    } catch (error) {
      this.setAsyncError(error)
    } finally {
      if (disposition !== "superseded") {
        this.pickerState = "closed"
        this.commitPickerController.state = "closed"
        this.loadingMessage = undefined
        this.commitPickerController.loadingMessage = undefined
        this.requestRender()
      }
    }
  }

  protected renderCommitPickerOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitPickerController.renderOverlayLines(baseLines.length, width, this.theme)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  // Kept for subclasses that still use this method (branch picker, stash picker, worktree picker)
  protected isBackspace(data: string): boolean {
    return isBackspace(data)
  }
}
