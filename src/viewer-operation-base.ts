import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import type { SettingsListTheme } from "@earendil-works/pi-tui"
import { contextForDocumentLoad, loadDiffDocument } from "./diff-document-loader.js"
import { type FailureDetails, failureDetails } from "./failure-details.js"
import { refreshWorkingTreeDocument } from "./git-working-tree-refresh.js"
import { copyPluginSettings, type PluginSettings } from "./plugin-settings.js"
import type { DiffDocument, DiffFile, DiffSlice, WorkingTreeRefreshScope, WorkingTreeView } from "./types.js"
import { type ViewerAction, viewerActionAvailability } from "./viewer-action-policy.js"
import {
  type DiffLoadRequest,
  type DocumentSelection,
  ViewerDocumentState,
  type ViewerInitialDocument,
} from "./viewer-document-state.js"
import {
  type LoadOutcome,
  type LoadSpec,
  type MutationOutcome,
  type MutationSpec,
  type OperationSnapshot,
  type RefreshIntent,
  ViewerOperationCoordinator,
} from "./viewer-operation-coordinator.js"

export interface DocumentLoadOptions {
  runningMessage: string
  successMessage?: string
  selection?: DocumentSelection
  recordFailure?: boolean
}

export interface DiffViewerOptions {
  readonly settings: PluginSettings
  readonly settingsListTheme: () => SettingsListTheme
  readonly saveSettings: (settings: PluginSettings) => Promise<void>
}

export class DiffViewerOperationBase {
  protected readonly ctx: ExtensionContext
  protected readonly documentState: ViewerDocumentState
  protected readonly done: () => void
  protected error: string | undefined
  protected errorDetails: string | undefined
  protected retainedFailure: FailureDetails | undefined
  protected readonly getTerminalRows: () => number
  protected loadingMessage: string | undefined
  protected readonly operationCoordinator: ViewerOperationCoordinator
  protected readonly pi: ExtensionAPI
  protected pluginSettings: PluginSettings
  protected readonly requestRender: () => void
  protected readonly settingsListTheme: () => SettingsListTheme
  protected statusMessage: string | undefined
  protected readonly theme: Theme
  private readonly savePluginSettings: (settings: PluginSettings) => Promise<void>

  constructor(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    theme: Theme,
    initialDocument: DiffDocument | ViewerInitialDocument,
    done: () => void,
    requestRender: () => void,
    getTerminalRows: () => number,
    viewerOptions: DiffViewerOptions,
  ) {
    this.pi = pi
    this.ctx = ctx
    this.theme = theme
    this.done = done
    this.requestRender = requestRender
    this.getTerminalRows = getTerminalRows
    this.pluginSettings = copyPluginSettings(viewerOptions.settings)
    this.settingsListTheme = viewerOptions.settingsListTheme
    this.savePluginSettings = viewerOptions.saveSettings
    this.documentState = new ViewerDocumentState(ctx.cwd, initialDocument)
    this.operationCoordinator = new ViewerOperationCoordinator({
      currentContext: () => ({ cwd: this.activePath(), generation: this.documentState.generation }),
      onChange: () => this.requestRender(),
      parentSignal: ctx.signal,
    })
  }

  protected get diffColumn(): number {
    return this.documentState.diffColumn
  }

  protected set diffColumn(value: number) {
    this.documentState.diffColumn = value
  }

  protected get diffScroll(): number {
    return this.documentState.diffScroll
  }

  protected set diffScroll(value: number) {
    this.documentState.diffScroll = value
  }

  protected get document(): DiffDocument {
    return this.documentState.document
  }

  protected get files(): DiffFile[] {
    return this.documentState.files
  }

  protected get visibleSlice(): DiffSlice {
    return this.documentState.slice
  }

  protected get workingTreeView(): WorkingTreeView {
    return this.documentState.workingTreeView
  }

  protected get selectedFileIndex(): number {
    return this.documentState.selectedFileIndex
  }

  protected set selectedFileIndex(value: number) {
    this.documentState.selectedFileIndex = value
  }

  protected applyPluginSettings(settings: PluginSettings): void {
    this.pluginSettings = copyPluginSettings(settings)
    this.diffColumn = 0
    this.diffScroll = 0
  }

  protected persistPluginSettings(settings: PluginSettings): Promise<void> {
    return this.savePluginSettings(settings)
  }

  protected activePath(): string {
    return this.documentState.activeCwd
  }

  protected activeContext(signal: AbortSignal | undefined = this.ctx.signal): ExtensionContext {
    return contextForDocumentLoad(this.ctx, this.activePath(), signal)
  }

  protected operationSnapshot(): OperationSnapshot {
    return this.operationCoordinator.snapshot
  }

  protected currentFailureDetails(): FailureDetails | undefined {
    const operationFailure = this.operationCoordinator.snapshot.failure
    if (operationFailure) {
      return operationFailure
    }
    if (this.documentState.failure) {
      return this.documentState.failure
    }
    if (this.retainedFailure) {
      return this.retainedFailure
    }
    if (!this.error) {
      return
    }
    return { summary: this.error, details: this.errorDetails ?? this.error, cause: this.error }
  }

  protected requireViewerAction(action: ViewerAction): boolean {
    const availability = viewerActionAvailability(this.document, action)
    if (availability.available) {
      return true
    }
    this.error = availability.reason ?? "That action is unavailable"
    this.errorDetails = this.error
    this.statusMessage = undefined
    this.requestRender()
    return false
  }

  protected canStartForegroundOperation(action: string): boolean {
    if (this.documentState.failure) {
      this.error = `Reload the diff with r before ${action}`
      this.errorDetails = this.documentState.failure.details
      this.statusMessage = undefined
      this.requestRender()
      return false
    }
    const reason = this.operationCoordinator.startBlockReason()
    if (!reason) {
      this.operationCoordinator.clearSettled()
      return true
    }
    this.error =
      reason === "refreshRequired"
        ? `Retry the diff refresh with r before ${action}`
        : `Wait for the current operation before ${action}`
    this.errorDetails = this.error
    this.statusMessage = undefined
    this.requestRender()
    return false
  }

  protected prepareOperation(): void {
    this.error = undefined
    this.errorDetails = undefined
    this.retainedFailure = undefined
    this.statusMessage = undefined
  }

  protected retainFailureDetails(failure: FailureDetails): void {
    this.retainedFailure = failure
  }

  protected runMutation<T, R>(spec: MutationSpec<T, R>): Promise<MutationOutcome<T>> {
    this.prepareOperation()
    if (this.documentState.failure) {
      return Promise.resolve({ kind: "rejected", reason: "refreshRequired" })
    }
    return this.operationCoordinator.runMutation(spec)
  }

  protected runLoad<T>(spec: LoadSpec<T>): Promise<LoadOutcome<T>> {
    this.prepareOperation()
    return this.operationCoordinator.runLoad(spec)
  }

  protected documentRefreshIntent(
    request: DiffLoadRequest = this.documentState.request,
    selection: DocumentSelection = this.documentState.captureSelection(),
  ): RefreshIntent<DiffDocument> {
    return {
      label: "diff refresh",
      selection,
      run: ({ signal }) => loadDiffDocument(this.pi, this.ctx, request, signal),
      apply: (document) => this.documentState.replaceDocument(request, document, selection),
    }
  }

  protected workingTreeRefreshIntent(
    cwd = this.activePath(),
    selection: DocumentSelection = this.documentState.captureSelection(),
    scope: WorkingTreeRefreshScope = "full",
  ): RefreshIntent<DiffDocument> {
    if (scope === "full" || this.document.mode !== "working") {
      return this.documentRefreshIntent({ kind: "working", cwd }, selection)
    }
    const current = this.document
    const request = { kind: "working" as const, cwd }
    return {
      label: "diff refresh",
      selection,
      run: async ({ signal }) =>
        (await refreshWorkingTreeDocument(this.pi, this.activeContext(signal), current, scope)).document,
      apply: (document) => {
        if (document.mode === "working" && document.files === current.files) this.documentState.updateMetadata(document)
        else this.documentState.replaceDocument(request, document, selection)
      },
    }
  }

  protected async loadDocument(
    request: DiffLoadRequest,
    options: DocumentLoadOptions,
  ): Promise<LoadOutcome<DiffDocument>> {
    const selection = options.selection ?? this.documentState.captureSelection()
    const outcome = await this.runLoad<DiffDocument>({
      label: request.kind === "working" ? "working tree" : `commit ${request.commit.hash}`,
      runningMessage: options.runningMessage,
      load: ({ signal }) => loadDiffDocument(this.pi, this.ctx, request, signal),
      apply: (document) => this.documentState.replaceDocument(request, document, selection),
      successMessage: options.successMessage === undefined ? undefined : () => options.successMessage as string,
    })
    if (outcome.kind === "failed" && options.recordFailure) {
      this.documentState.recordLoadFailure(request, outcome.failure.cause)
      this.operationCoordinator.clearSettled()
      this.requestRender()
    }
    return outcome
  }

  protected async reloadCurrentDocument(): Promise<LoadOutcome<DiffDocument>> {
    return this.loadDocument(this.documentState.reloadRequest, {
      runningMessage: "Reloading diff…",
      successMessage: "Diff reloaded",
      recordFailure: true,
    })
  }

  protected retryRefreshOnly(): Promise<LoadOutcome<unknown>> {
    this.prepareOperation()
    return this.operationCoordinator.retryRefresh()
  }

  protected cancelActiveOperation(): boolean {
    return this.operationCoordinator.cancelActive()
  }

  protected isOperationBusy(): boolean {
    return this.operationCoordinator.isBusy()
  }

  protected showOperationRejection(action: string): void {
    if (this.documentState.failure) {
      this.error = `Reload the diff with r before ${action}`
      this.errorDetails = this.documentState.failure.details
    } else {
      this.error = `Cannot ${action} while another operation is active`
      this.errorDetails = this.error
    }
    this.statusMessage = undefined
    this.requestRender()
  }

  protected showUnexpectedError(error: unknown): void {
    const failure = failureDetails(error, "Unexpected operation failure")
    this.error = failure.summary
    this.errorDetails = failure.details
    this.loadingMessage = undefined
    this.requestRender()
  }
}
