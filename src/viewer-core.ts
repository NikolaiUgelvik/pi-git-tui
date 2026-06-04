import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff, stageOrUnstageFile, toggleAllChangesStaged } from "./git.js"
import { fit } from "./render-text.js"
import { buildTreeRows } from "./tree.js"
import type { CommitSummary, DiffDocument, FocusPanel, HelpContext } from "./types.js"

export class DiffViewerCore {
  protected document: DiffDocument
  protected readonly pi: ExtensionAPI
  protected readonly ctx: ExtensionContext
  protected readonly theme: Theme
  protected readonly done: () => void
  protected readonly requestRender: () => void

  protected selectedFileIndex = 0
  protected diffScroll = 0
  protected commitScroll = 0
  protected selectedCommitIndex = 0
  protected commandMenuScroll = 0
  protected selectedCommandIndex = 0
  protected focusedPanel: FocusPanel = "tree"
  protected commits: CommitSummary[] = []
  protected commitSearchQuery = ""
  protected commandMenuSearchQuery = ""
  protected commitMessage = ""
  protected commitMessageCaret = 0
  protected commitAmend = false
  protected pickerState: "closed" | "loading" | "open" = "closed"
  protected commandMenuState: "closed" | "loading" | "open" = "closed"
  protected commitDialogState: "closed" | "loading" | "open" = "closed"
  protected helpContext: HelpContext | undefined
  protected loadingMessage: string | undefined
  protected statusMessage: string | undefined
  protected error: string | undefined

  constructor(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    theme: Theme,
    document: DiffDocument,
    done: () => void,
    requestRender: () => void,
    protected readonly getTerminalRows: () => number,
  ) {
    this.pi = pi
    this.ctx = ctx
    this.theme = theme
    this.document = document
    this.done = done
    this.requestRender = requestRender
    this.resetSelectionToFirstTreeFile()
  }

  protected handleHelpInput(data: string): boolean {
    if (this.helpContext !== undefined) {
      if (this.isHelpCloseInput(data)) {
        this.helpContext = undefined
        this.requestRender()
      }
      return true
    }
    if (!this.isHelpKey(data)) {
      return false
    }
    this.helpContext = this.currentHelpContext()
    this.requestRender()
    return true
  }

  protected isHelpCloseInput(data: string): boolean {
    return this.isHelpKey(data) || matchesKey(data, "escape") || this.isKey(data, "q")
  }

  protected isHelpKey(data: string): boolean {
    return data === "?"
  }

  protected currentHelpContext(): HelpContext {
    if (this.commitDialogState !== "closed") {
      return "commitDialog"
    }
    if (this.commandMenuState !== "closed") {
      return "commandMenu"
    }
    if (this.pickerState !== "closed") {
      return "commitPicker"
    }
    return "viewer"
  }

  protected handleActiveOverlayInput(data: string): boolean {
    if (this.commitDialogState !== "closed") {
      this.handleCommitDialogInput(data)
      return true
    }
    if (this.commandMenuState !== "closed") {
      this.handleCommandMenuInput(data)
      return true
    }
    if (this.pickerState !== "closed") {
      this.handleCommitPickerInput(data)
      return true
    }
    return false
  }

  protected handleCloseInput(data: string): boolean {
    if (!this.isKey(data, "q") && !matchesKey(data, "escape")) {
      return false
    }
    this.done()
    return true
  }

  protected handleOpenOverlayInput(data: string): boolean {
    const handlers = [
      () => this.handleOpenCommitDialogInput(data),
      () => this.handleOpenPickerInput(data),
      () => this.handleOpenCommandMenuInput(data),
    ]
    return handlers.some((handler) => handler())
  }

  protected handleOpenPickerInput(data: string): boolean {
    if (data !== "c") {
      return false
    }
    this.openCommitPicker().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleOpenCommitDialogInput(data: string): boolean {
    if (data !== "C") {
      return false
    }
    this.openCommitDialog()
    return true
  }

  protected handleOpenCommandMenuInput(data: string): boolean {
    if (!matchesKey(data, "ctrl+p")) {
      return false
    }
    this.openCommandMenu()
    return true
  }

  protected handleViewerNavigationInput(data: string): void {
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
      if (handler()) {
        return
      }
    }
  }

  protected handleFocusToggle(data: string): boolean {
    if (!matchesKey(data, "tab")) {
      return false
    }
    this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree"
    return true
  }

  protected handleStageAllInput(data: string): boolean {
    if (!this.isShiftEnter(data)) {
      return false
    }
    if (this.document.mode !== "working") {
      this.error = "Staging is only available in the working tree"
      this.statusMessage = undefined
      return true
    }
    this.stageAllVisibleChanges().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleFileStageToggle(data: string): boolean {
    if (!this.isEnter(data) || this.focusedPanel !== "tree") {
      return false
    }
    if (this.document.mode !== "working") {
      this.error = "Staging is only available in the working tree"
      this.statusMessage = undefined
      return true
    }
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      return true
    }
    this.toggleSelectedFileStage(file.path).catch((error: unknown) => this.showAsyncError(error))
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
    if (matchesKey(data, "up") || this.isKey(data, "k")) {
      return -1
    }
    if (matchesKey(data, "down") || this.isKey(data, "j")) {
      return 1
    }
    return 0
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
    return data === key || data === key.toUpperCase()
  }

  protected isEnter(data: string): boolean {
    return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n"
  }

  protected isShiftEnter(data: string): boolean {
    return matchesKey(data, "shift+enter") || data === "\x1b[13;2u"
  }

  protected isPageUp(data: string): boolean {
    return matchesKey(data, "pageUp") || data === "\x1b[5~"
  }

  protected isPageDown(data: string): boolean {
    return matchesKey(data, "pageDown") || data === "\x1b[6~"
  }

  protected isPrintableInput(data: string): boolean {
    if (data.length === 0 || data.includes("\x1b")) {
      return false
    }
    return [...data].every((char) => {
      const codePoint = char.codePointAt(0)
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
    })
  }

  protected showAsyncError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error)
    this.statusMessage = undefined
    this.pickerState = "closed"
    this.commandMenuState = "closed"
    this.commitDialogState = "closed"
    this.loadingMessage = undefined
    this.requestRender()
  }

  protected renderOverlays(baseLines: string[], width: number): string[] {
    return baseLines.map((line) => fit(line, width))
  }

  protected handleCommitDialogInput(_data: string): void {}

  protected handleCommandMenuInput(_data: string): void {}

  protected handleCommitPickerInput(_data: string): void {}

  protected openCommitPicker(): Promise<void> {
    return Promise.resolve()
  }

  protected openCommitDialog(): void {}

  protected openCommandMenu(): void {}
  protected viewHeight(): number {
    // The custom diff viewer is shown as an overlay with a 1-row margin. Keep the
    // component shorter than the visible terminal so re-renders never push content
    // into scrollback when users browse with arrow keys or PageUp/PageDown.
    const maxTotalLines = Math.max(10, this.getTerminalRows() - 2)
    const chromeLines = 7 // border, header, subtitle, dividers, footer, border
    return Math.max(5, maxTotalLines - chromeLines)
  }

  protected pageScrollSize(): number {
    return Math.max(1, Math.floor((this.viewHeight() - 1) / 2))
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
    return buildTreeRows(this.document.files)
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

  protected selectFileByPath(path: string): boolean {
    const fileIndex = this.document.files.findIndex((file) => file.path === path)
    if (fileIndex < 0) {
      return false
    }
    this.selectedFileIndex = fileIndex
    this.diffScroll = 0
    return true
  }

  protected async refreshWorkingTreePreservingFile(path: string): Promise<void> {
    this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
    if (!this.selectFileByPath(path)) {
      this.resetSelectionToFirstTreeFile()
    }
  }

  protected async toggleSelectedFileStage(path: string): Promise<void> {
    this.error = undefined
    this.statusMessage = `Updating ${path}…`
    this.requestRender()
    try {
      const message = await stageOrUnstageFile(this.pi, this.ctx.cwd, path, this.ctx.signal)
      await this.refreshWorkingTreePreservingFile(path)
      this.statusMessage = message
    } catch (error) {
      this.statusMessage = undefined
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.requestRender()
    }
  }

  protected async stageAllVisibleChanges(): Promise<void> {
    this.error = undefined
    this.statusMessage = "Staging all changes…"
    this.requestRender()
    try {
      this.statusMessage = await toggleAllChangesStaged(this.pi, this.ctx.cwd, this.ctx.signal)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
    } catch (error) {
      this.statusMessage = undefined
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.requestRender()
    }
  }

  protected searchTokens(query: string): string[] {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  }

  protected matchesSearch(value: string, tokens: string[]): boolean {
    const haystack = value.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  }

  protected nextListSelectionIndex(data: string, selectedIndex: number, itemCount: number): number | undefined {
    const lastIndex = Math.max(0, itemCount - 1)
    if (matchesKey(data, "up")) {
      return Math.max(0, selectedIndex - 1)
    }
    if (matchesKey(data, "down")) {
      return Math.min(lastIndex, selectedIndex + 1)
    }
    return this.nextListSelectionPageIndex(data, selectedIndex, lastIndex)
  }

  protected nextListSelectionPageIndex(data: string, selectedIndex: number, lastIndex: number): number | undefined {
    if (this.isPageUp(data)) {
      return Math.max(0, selectedIndex - 10)
    }
    if (this.isPageDown(data)) {
      return Math.min(lastIndex, selectedIndex + 10)
    }
    if (matchesKey(data, "home")) {
      return 0
    }
    if (matchesKey(data, "end")) {
      return lastIndex
    }
  }

  protected nextListScroll(selectedIndex: number, currentScroll: number, itemCount: number, maxItems: number): number {
    const maxScroll = Math.max(0, itemCount - maxItems)
    const centeredScroll = Math.max(0, selectedIndex - Math.floor(maxItems / 2))
    let scroll = Math.max(0, Math.min(currentScroll, maxScroll, centeredScroll))
    if (selectedIndex < scroll) {
      scroll = selectedIndex
    }
    if (selectedIndex >= scroll + maxItems) {
      scroll = selectedIndex - maxItems + 1
    }
    return scroll
  }
}
