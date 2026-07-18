import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import { isGitAbortError } from "./git-service.js"
import { fit } from "./render-text.js"
import type { TreeRow } from "./tree.js"
import type { DiffDocument, DiffFile, FocusPanel, HelpContext } from "./types.js"
import {
  isEnterInput,
  isHelpCloseInput as isHelpCloseKey,
  isHelpKey as isHelpOpenKey,
  isPrintableInput as isPrintableKey,
  isViewerKey,
} from "./viewer-key-input.js"
import {
  type DocumentLoadDisposition,
  type MutationRun,
  type ViewerMutationKind,
  ViewerOperationCoordinator,
} from "./viewer-operation-coordinator.js"
import { type SelectedFileDisplay, ViewerRenderCache, type ViewerRenderCacheStats } from "./viewer-render-cache.js"

export type SelectionPolicy = "preserve-current-path" | "first"

interface FileSelectionSnapshot {
  readonly file: DiffFile
  readonly exactOccurrence: number
  readonly pathOccurrence: number
}

function logicalChangeKey(file: DiffFile): string {
  return JSON.stringify([
    file.path,
    file.oldPath,
    file.newPath,
    file.status,
    file.staged,
    file.untracked,
    file.untrackedRole,
    file.submodule,
  ])
}

function sameLogicalChange(left: DiffFile, right: DiffFile): boolean {
  return logicalChangeKey(left) === logicalChangeKey(right)
}

function occurrenceBefore(files: readonly DiffFile[], index: number, matches: (file: DiffFile) => boolean): number {
  return files.slice(0, index).filter(matches).length
}

function fileSelectionSnapshot(files: readonly DiffFile[], index: number): FileSelectionSnapshot | undefined {
  const file = files[index]
  if (!file) return
  return {
    file,
    exactOccurrence: occurrenceBefore(files, index, (candidate) => sameLogicalChange(candidate, file)),
    pathOccurrence: occurrenceBefore(files, index, (candidate) => candidate.path === file.path),
  }
}

function matchingIndex(
  files: readonly DiffFile[],
  occurrence: number,
  matches: (file: DiffFile) => boolean,
): number | undefined {
  const indexes = files.flatMap((file, index) => (matches(file) ? [index] : []))
  return indexes[occurrence] ?? indexes[0]
}

function preservedFileIndex(files: readonly DiffFile[], selection: FileSelectionSnapshot): number | undefined {
  return (
    matchingIndex(files, selection.exactOccurrence, (file) => sameLogicalChange(file, selection.file)) ??
    matchingIndex(files, selection.pathOccurrence, (file) => file.path === selection.file.path)
  )
}

export class DiffViewerCore {
  protected document: DiffDocument
  protected readonly pi: ExtensionAPI
  protected readonly ctx: ExtensionContext
  protected readonly theme: Theme
  protected readonly done: () => void
  protected readonly requestRender: () => void
  protected readonly viewerSignal: AbortSignal
  protected readonly operationCoordinator: ViewerOperationCoordinator
  protected activeCwd: string

  private readonly renderCache: ViewerRenderCache
  private readonly viewerAbortController = new AbortController()
  private readonly contextSignal: AbortSignal | undefined
  private readonly abortFromContext = () => this.viewerAbortController.abort()
  private viewerClosed = false

  protected selectedFileIndex = 0
  protected diffScroll = 0
  protected focusedPanel: FocusPanel = "tree"
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
    this.requestRender = () => {
      if (!this.viewerClosed && !this.viewerAbortController.signal.aborted) {
        requestRender()
      }
    }
    this.activeCwd = ctx.cwd
    this.contextSignal = ctx.signal
    this.viewerSignal = this.viewerAbortController.signal
    if (this.contextSignal?.aborted) {
      this.viewerAbortController.abort()
    } else {
      this.contextSignal?.addEventListener("abort", this.abortFromContext, { once: true })
    }
    this.operationCoordinator = new ViewerOperationCoordinator({ signal: this.viewerSignal })
    this.renderCache = new ViewerRenderCache(document.files)
    this.resetSelectionToFirstTreeFile()
  }

  protected activePath(): string {
    return this.activeCwd
  }

  protected activeContext(signal: AbortSignal = this.viewerSignal): ExtensionContext {
    return this.contextFor(this.activePath(), signal)
  }

  protected contextFor(cwd: string, signal: AbortSignal = this.viewerSignal): ExtensionContext {
    return { ...this.ctx, cwd, signal }
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
    return isHelpCloseKey(data)
  }

  protected isHelpKey(data: string): boolean {
    return isHelpOpenKey(data)
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

  protected isOperationLoading(): boolean {
    return (
      this.operationCoordinator.mutationActive ||
      this.pickerState === "loading" ||
      this.commandMenuState === "loading" ||
      this.commitDialogState === "loading"
    )
  }

  protected mutationActive(): boolean {
    return this.operationCoordinator.mutationActive
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
    this.closeViewer()
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
    if (!this.mutationActive()) {
      this.openCommitPicker().catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected handleOpenCommitDialogInput(data: string): boolean {
    if (data !== "C") {
      return false
    }
    if (!this.mutationActive()) {
      this.openCommitDialog()
    }
    return true
  }

  protected handleOpenCommandMenuInput(data: string): boolean {
    if (!matchesKey(data, "ctrl+p")) {
      return false
    }
    if (!this.mutationActive()) {
      this.openCommandMenu()
    }
    return true
  }

  protected isKey(data: string, key: string): boolean {
    return isViewerKey(data, key)
  }

  protected isEnter(data: string): boolean {
    return isEnterInput(data)
  }

  protected isPrintableInput(data: string): boolean {
    return isPrintableKey(data)
  }

  protected showAsyncError(error: unknown): void {
    if (!this.setAsyncError(error)) {
      return
    }
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

  protected setAsyncError(error: unknown): boolean {
    if (isGitAbortError(error)) {
      return false
    }
    this.error = error instanceof Error ? error.message : String(error)
    return true
  }

  private closeViewer(): void {
    if (this.viewerClosed) {
      return
    }
    this.viewerClosed = true
    this.contextSignal?.removeEventListener("abort", this.abortFromContext)
    this.operationCoordinator.dispose()
    this.viewerAbortController.abort()
    this.done()
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
    const currentOrderIndex = this.renderCache.treeFileOrderIndex(this.selectedFileIndex) ?? 0
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

  protected treeFileOrder(): readonly number[] {
    return this.renderCache.treeFileOrder()
  }

  protected treeRows(): readonly TreeRow[] {
    return this.renderCache.treeRows()
  }

  protected treeRowIndex(fileIndex: number): number | undefined {
    return this.renderCache.treeRowIndex(fileIndex)
  }

  protected selectedFileDisplay(): SelectedFileDisplay | undefined {
    return this.renderCache.selectedFileDisplay(this.selectedFileIndex)
  }

  protected renderCacheStats(): ViewerRenderCacheStats {
    return this.renderCache.stats()
  }

  protected invalidateRenderCache(): void {
    this.renderCache.invalidate()
  }

  protected scrollDiff(delta: number): void {
    this.diffScroll = Math.max(0, this.diffScroll + delta)
  }

  protected resetSelectionToFirstTreeFile(): void {
    this.selectedFileIndex = this.treeFileOrder()[0] ?? 0
    this.diffScroll = 0
  }

  protected selectFileByPath(path: string): boolean {
    const fileIndex = this.renderCache.fileIndexForPath(path)
    if (fileIndex === undefined) {
      return false
    }
    this.selectedFileIndex = fileIndex
    this.diffScroll = 0
    return true
  }

  protected runMutation<T>(
    kind: ViewerMutationKind,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<MutationRun<T>> {
    return this.operationCoordinator.runMutation(kind, task)
  }

  protected loadLatestDocument(request: {
    cwd: string
    target: string
    selection: SelectionPolicy
    load: (signal: AbortSignal) => Promise<DiffDocument>
    operationSignal?: AbortSignal
  }): Promise<DocumentLoadDisposition> {
    return this.operationCoordinator.applyLatest(
      request.target,
      request.load,
      (document) => {
        this.applyDocument(document, request.cwd, request.selection)
      },
      request.operationSignal,
    )
  }

  protected applyDocument(document: DiffDocument, cwd: string, selection: SelectionPolicy): void {
    const selected = fileSelectionSnapshot(this.document.files, this.selectedFileIndex)
    const preservesContent = selection === "preserve-current-path" && document.files === this.document.files
    this.document = document
    this.renderCache.replaceDocument(document.files)
    this.activeCwd = cwd
    if (preservesContent) return
    const preservedIndex = selected ? preservedFileIndex(document.files, selected) : undefined
    if (selection === "preserve-current-path" && preservedIndex !== undefined) {
      this.selectedFileIndex = preservedIndex
      this.diffScroll = 0
      return
    }
    this.resetSelectionToFirstTreeFile()
  }
}
