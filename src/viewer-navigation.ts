import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff, stageOrUnstageFile, toggleAllChangesStaged } from "./git.js"
import type { DiffFile } from "./types.js"
import { DiffViewerCore, type SelectionPolicy } from "./viewer-core.js"
import {
  arrowScrollDelta as inputArrowScrollDelta,
  isPageDownInput,
  isPageUpInput,
  isShiftEnterInput,
} from "./viewer-key-input.js"

export class DiffViewerNavigation extends DiffViewerCore {
  protected handleViewerNavigationInput(data: string): boolean {
    const handlers = [
      () => this.handleFocusToggle(data),
      () => this.handleStageAllInput(data),
      () => this.handleFileStageToggle(data),
      () => this.handleFileStep(data),
      () => this.handleArrowScroll(data),
      () => this.handlePageScroll(data),
      () => this.handleEdgeJump(data),
    ]
    for (const handler of handlers) {
      if (handler()) return true
    }
    return false
  }

  protected handleFocusToggle(data: string): boolean {
    if (!matchesKey(data, "tab")) return false
    this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree"
    return true
  }

  protected handleStageAllInput(data: string): boolean {
    if (!isShiftEnterInput(data)) return false
    if (this.document.mode !== "working") {
      this.error = "Staging is only available in the working tree"
      this.statusMessage = undefined
      return true
    }
    if (this.document.omittedFileCount > 0) {
      this.error = "Cannot stage all while some diffs are omitted"
      this.statusMessage = undefined
      return true
    }
    if (this.document.files.some((file) => file.submodule?.startsWith("S"))) {
      this.error = "Cannot stage all while nested submodule changes are present"
      this.statusMessage = undefined
      return true
    }
    this.stageAllVisibleChanges().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleFileStageToggle(data: string): boolean {
    if (!this.isEnter(data) || this.focusedPanel !== "tree") return false
    if (this.document.mode !== "working") {
      this.error = "Staging is only available in the working tree"
      this.statusMessage = undefined
      return true
    }
    const file = this.document.files[this.selectedFileIndex]
    if (!file) return true
    if (file.omission) {
      this.error = `Cannot stage ${file.path} because its diff was omitted`
      this.statusMessage = undefined
      return true
    }
    if (file.submodule?.startsWith("S")) {
      this.error = `Cannot stage ${file.path}: manage nested changes inside the submodule`
      this.statusMessage = undefined
      return true
    }
    this.toggleSelectedFileStage(file).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleFileStep(data: string): boolean {
    if (this.isKey(data, "n")) {
      this.moveFile(1)
      return true
    }
    if (this.isKey(data, "p")) {
      this.moveFile(-1)
      return true
    }
    return false
  }

  protected handleArrowScroll(data: string): boolean {
    const delta = this.arrowScrollDelta(data)
    if (delta === 0) return false
    if (this.focusedPanel === "tree") {
      this.moveFile(delta)
    } else {
      this.scrollDiff(delta)
    }
    return true
  }

  protected arrowScrollDelta(data: string): number {
    return inputArrowScrollDelta(data)
  }

  protected handlePageScroll(data: string): boolean {
    if (isPageUpInput(data)) {
      this.scrollDiff(-this.pageScrollSize())
      return true
    }
    if (isPageDownInput(data) || matchesKey(data, "space")) {
      this.scrollDiff(this.pageScrollSize())
      return true
    }
    return false
  }

  protected handleEdgeJump(data: string): boolean {
    if (matchesKey(data, "home")) {
      this.jumpToEdge("first")
      return true
    }
    if (matchesKey(data, "end")) {
      this.jumpToEdge("last")
      return true
    }
    return false
  }

  protected jumpToEdge(edge: "first" | "last"): void {
    if (this.focusedPanel === "tree") {
      this.selectTreeEdge(edge)
      return
    }
    this.diffScroll = edge === "first" ? 0 : Number.MAX_SAFE_INTEGER
  }

  protected async refreshWorkingTreeAfterMutationFailure(
    cwd: string,
    operationSignal: AbortSignal,
    selection: SelectionPolicy = "preserve-current-path",
  ): Promise<"applied" | "superseded"> {
    const operationError = this.error
    try {
      return await this.loadLatestDocument({
        cwd,
        target: `working:${cwd}:failure`,
        selection,
        load: (signal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, signal)),
        operationSignal,
      })
    } catch (refreshError) {
      if (this.setAsyncError(refreshError)) {
        this.error = `${operationError}; refresh failed: ${this.error}`
      }
      return "applied"
    }
  }

  private async executeStageMutation(
    pendingMessage: string,
    operation: (cwd: string, signal: AbortSignal) => Promise<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const cwd = this.activePath()
    this.error = undefined
    this.statusMessage = pendingMessage
    this.requestRender()
    try {
      const message = await operation(cwd, signal)
      const disposition = await this.loadLatestDocument({
        cwd,
        target: `working:${cwd}`,
        selection: "preserve-current-path",
        load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
        operationSignal: signal,
      })
      if (disposition === "applied") this.statusMessage = message
    } catch (error) {
      if (this.setAsyncError(error)) {
        this.statusMessage = undefined
        await this.refreshWorkingTreeAfterMutationFailure(cwd, signal)
      }
    } finally {
      this.requestRender()
    }
  }

  protected async toggleSelectedFileStage(file: DiffFile): Promise<void> {
    await this.runMutation("stage-file", (signal) =>
      this.executeStageMutation(
        `Updating ${file.path}…`,
        (cwd, operationSignal) => stageOrUnstageFile(this.pi, cwd, file, operationSignal),
        signal,
      ),
    )
  }

  protected async stageAllVisibleChanges(): Promise<void> {
    await this.runMutation("stage-all", (signal) =>
      this.executeStageMutation(
        "Staging all changes…",
        (cwd, operationSignal) => toggleAllChangesStaged(this.pi, cwd, operationSignal),
        signal,
      ),
    )
  }
}
