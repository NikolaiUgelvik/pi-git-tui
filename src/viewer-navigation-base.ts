import { matchesKey } from "@earendil-works/pi-tui"
import { stageAllRemaining, stageRemainingFile, unstageAll, unstageFile } from "./git.js"
import { measureViewerGeometry, SPLIT_LAYOUT_MIN_WIDTH } from "./responsive-geometry.js"
import { buildTreeRows } from "./tree.js"
import type { DiffFile, FocusPanel } from "./types.js"
import { stagingBlockReason } from "./viewer-index-policy.js"
import {
  horizontalScrollDelta,
  arrowScrollDelta as inputArrowScrollDelta,
  isEnterInput,
  isPageDownInput,
  isPageUpInput,
  isPrintableInput as isPrintableKey,
  isShiftEnterInput,
  isViewerKey,
} from "./viewer-key-input.js"
import { DiffViewerOperationBase } from "./viewer-operation-base.js"

export class DiffViewerNavigationBase extends DiffViewerOperationBase {
  protected focusedPanel: FocusPanel = "tree"

  protected handleViewerNavigationInput(data: string): void {
    const handlers = [
      () => this.handleReloadInput(data),
      () => this.handleFocusToggle(data),
      () => this.handleWorkingTreeViewInput(data),
      () => this.handleStageAllInput(data),
      () => this.handleFileStageToggle(data),
      () => this.handleFileStep(data),
      () => this.handleHorizontalScroll(data),
      () => this.handleArrowScroll(data),
      () => this.handlePageScroll(data),
      () => this.handleEdgeJump(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleReloadInput(data: string): boolean {
    if (data !== "r") {
      return false
    }
    const operation = this.operationSnapshot()
    const reload = operation.canRetryRefresh ? this.retryRefreshOnly() : this.reloadCurrentDocument()
    reload.catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleFocusToggle(data: string): boolean {
    if (!matchesKey(data, "tab")) {
      return false
    }
    this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree"
    return true
  }

  protected handleWorkingTreeViewInput(data: string): boolean {
    if (data !== "v") {
      return false
    }
    if (!this.requireViewerAction("toggleView")) {
      return true
    }
    this.documentState.setWorkingTreeView(this.workingTreeView === "working" ? "staged" : "working")
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
    return true
  }

  protected handleStageAllInput(data: string): boolean {
    if (!this.isShiftEnter(data)) {
      return false
    }
    if (!this.stagingAvailable("stageAll") || !this.canStartForegroundOperation("staging changes")) {
      return true
    }
    this.stageAllVisibleChanges().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleFileStageToggle(data: string): boolean {
    if (!this.isEnter(data) || this.focusedPanel !== "tree") {
      return false
    }
    if (!this.stagingAvailable("stageFile") || !this.canStartForegroundOperation("staging changes")) {
      return true
    }
    const file = this.files[this.selectedFileIndex]
    if (file) {
      this.updateSelectedFileStage(file).catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  private stagingAvailable(action: "stageFile" | "stageAll"): boolean {
    if (!this.requireViewerAction(action)) {
      return false
    }
    if (this.documentState.failure) {
      this.error = "Reload the diff with r before staging changes"
      this.errorDetails = this.documentState.failure.details
      this.statusMessage = undefined
      return false
    }
    const reason = stagingBlockReason(this.document)
    if (!reason) {
      return true
    }
    this.error = reason
    this.errorDetails = reason
    this.statusMessage = undefined
    return false
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

  protected handleHorizontalScroll(data: string): boolean {
    if (this.focusedPanel !== "diff") {
      return false
    }
    const delta = horizontalScrollDelta(data)
    if (delta === 0) {
      return false
    }
    this.diffColumn = Math.max(0, this.diffColumn + delta)
    return true
  }

  protected handleArrowScroll(data: string): boolean {
    const delta = this.arrowScrollDelta(data)
    if (delta === 0) {
      return false
    }
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
    if (this.isPageUp(data)) {
      this.scrollDiff(-this.pageScrollSize())
      return true
    }
    if (this.isPageDown(data) || matchesKey(data, "space")) {
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

  protected isKey(data: string, key: string): boolean {
    return isViewerKey(data, key)
  }

  protected isEnter(data: string): boolean {
    return isEnterInput(data)
  }

  protected isShiftEnter(data: string): boolean {
    return isShiftEnterInput(data)
  }

  protected isPageUp(data: string): boolean {
    return isPageUpInput(data)
  }

  protected isPageDown(data: string): boolean {
    return isPageDownInput(data)
  }

  protected isPrintableInput(data: string): boolean {
    return isPrintableKey(data)
  }

  protected viewHeight(): number {
    return measureViewerGeometry({
      width: SPLIT_LAYOUT_MIN_WIDTH,
      terminalRows: this.getTerminalRows(),
      focusedPanel: this.focusedPanel,
      empty: false,
    }).panelRows
  }

  protected pageScrollSize(): number {
    return Math.max(1, Math.ceil(this.viewHeight() / 2))
  }

  protected moveFile(delta: number): void {
    const fileOrder = this.treeFileOrder()
    if (fileOrder.length === 0) {
      return
    }
    const currentOrderIndex = Math.max(0, fileOrder.indexOf(this.selectedFileIndex))
    const nextOrderIndex = Math.max(0, Math.min(fileOrder.length - 1, currentOrderIndex + delta))
    this.selectedFileIndex = fileOrder[nextOrderIndex] ?? this.selectedFileIndex
    this.diffScroll = 0
  }

  protected selectTreeEdge(edge: "first" | "last"): void {
    const fileOrder = this.treeFileOrder()
    if (fileOrder.length === 0) {
      return
    }
    this.selectedFileIndex = fileOrder[edge === "first" ? 0 : fileOrder.length - 1] ?? this.selectedFileIndex
    this.diffScroll = 0
  }

  protected treeFileOrder(): number[] {
    return buildTreeRows(this.files)
      .map((row) => row.fileIndex)
      .filter((index): index is number => index !== undefined)
  }

  protected scrollDiff(delta: number): void {
    this.diffScroll = Math.max(0, this.diffScroll + delta)
  }

  protected resetSelectionToFirstTreeFile(): void {
    this.selectedFileIndex = this.treeFileOrder()[0] ?? 0
    this.diffScroll = 0
  }

  protected async updateSelectedFileStage(file: DiffFile): Promise<void> {
    if (!this.requireViewerAction("stageFile")) {
      return
    }
    const cwd = this.activePath()
    const selection = this.documentState.captureSelection(file.path)
    const staging = this.workingTreeView === "working"
    const action = staging ? "stage remaining changes in" : "unstage"
    const outcome = await this.runMutation({
      label: `${action} ${file.path}`,
      runningMessage: `${staging ? "Staging remaining changes in" : "Unstaging"} ${file.path}…`,
      mutate: ({ signal }) =>
        staging ? stageRemainingFile(this.pi, cwd, file, signal) : unstageFile(this.pi, cwd, file, signal),
      successMessage: (message) => message,
      refresh: this.workingTreeRefreshIntent(cwd, selection),
      reconcileOnFailure: true,
    })
    if (outcome.kind === "rejected") {
      this.showOperationRejection(staging ? "stage changes" : "unstage changes")
    }
  }

  protected async stageAllVisibleChanges(): Promise<void> {
    if (!this.requireViewerAction("stageAll")) {
      return
    }
    const cwd = this.activePath()
    const selection = this.documentState.captureSelection()
    const staging = this.workingTreeView === "working"
    const outcome = await this.runMutation({
      label: staging ? "stage all remaining changes" : "unstage all changes",
      runningMessage: staging ? "Staging all remaining changes…" : "Unstaging all changes…",
      mutate: ({ signal }) => (staging ? stageAllRemaining(this.pi, cwd, signal) : unstageAll(this.pi, cwd, signal)),
      successMessage: (message) => message,
      refresh: this.workingTreeRefreshIntent(cwd, selection),
      reconcileOnFailure: true,
    })
    if (outcome.kind === "rejected") {
      this.showOperationRejection(staging ? "stage changes" : "unstage changes")
    }
  }

  protected showAsyncError(error: unknown): void {
    this.showUnexpectedError(error)
  }
}
