import { buildCommitDocument, diffFileAliases, emptyWorkingTreeDocument, selectDiffSlice } from "./diff-document.js"
import { type FailureDetails, failureDetails } from "./failure-details.js"
import { buildTreeRows } from "./tree.js"
import type { CommitSummary, DiffDocument, DiffFile, DiffSlice, WorkingTreeView } from "./types.js"

export type DiffLoadRequest = { kind: "working"; cwd: string } | { kind: "commit"; cwd: string; commit: CommitSummary }

export interface DocumentSelection {
  preferredPath?: string
  aliases: string[]
  status?: DiffFile["status"]
  stageState?: DiffFile["stageState"]
  untracked?: boolean
}

export interface DocumentLoadFailure extends FailureDetails {
  request: DiffLoadRequest
}

export type ViewerInitialDocument =
  | { status: "loaded"; document: DiffDocument; request?: DiffLoadRequest }
  | { status: "failed"; request: DiffLoadRequest; failure: DocumentLoadFailure }

function documentLoadFailure(request: DiffLoadRequest, error: unknown): DocumentLoadFailure {
  return { ...failureDetails(error, "Failed to load git diff"), request }
}

export function loadedViewerDocument(document: DiffDocument, request?: DiffLoadRequest): ViewerInitialDocument {
  return { status: "loaded", document, request }
}

export function failedViewerDocument(request: DiffLoadRequest, error: unknown): ViewerInitialDocument {
  return { status: "failed", request, failure: documentLoadFailure(request, error) }
}

function inferredRequest(document: DiffDocument, cwd: string): DiffLoadRequest {
  if (document.mode === "commit") {
    return { kind: "commit", cwd, commit: document.commit }
  }
  return { kind: "working", cwd }
}

function unavailableDocument(request: DiffLoadRequest): DiffDocument {
  if (request.kind === "commit") {
    return buildCommitDocument({
      title: "Diff unavailable",
      subtitle: request.cwd,
      raw: "",
      commit: request.commit,
    })
  }
  return emptyWorkingTreeDocument("Diff unavailable", request.cwd)
}

function isInitialState(value: DiffDocument | ViewerInitialDocument): value is ViewerInitialDocument {
  return "status" in value
}

function requestsMatch(left: DiffLoadRequest, right: DiffLoadRequest): boolean {
  if (left.kind !== right.kind || left.cwd !== right.cwd) {
    return false
  }
  return left.kind === "working" || (right.kind === "commit" && left.commit.hash === right.commit.hash)
}

export class ViewerDocumentState {
  private _activeCwd: string
  private _diffColumn = 0
  private _diffScroll = 0
  private _document: DiffDocument
  private _failedTarget: DocumentLoadFailure | undefined
  private _failure: DocumentLoadFailure | undefined
  private _generation = 0
  private _reloadRequest: DiffLoadRequest | undefined
  private _request: DiffLoadRequest
  private _selectedFileIndex = 0
  private _workingTreeView: WorkingTreeView = "working"

  constructor(initialCwd: string, initial: DiffDocument | ViewerInitialDocument) {
    if (!isInitialState(initial)) {
      this._activeCwd = initialCwd
      this._document = initial
      this._request = inferredRequest(initial, initialCwd)
      this._selectedFileIndex = this.selectionIndex(initial, { aliases: [] })
      return
    }
    if (initial.status === "loaded") {
      const request = initial.request ?? inferredRequest(initial.document, initialCwd)
      this._activeCwd = request.cwd
      this._document = initial.document
      this._request = request
      this._selectedFileIndex = this.selectionIndex(initial.document, { aliases: [] })
      return
    }
    this._activeCwd = initial.request.cwd
    this._document = unavailableDocument(initial.request)
    this._failure = initial.failure
    this._reloadRequest = initial.request
    this._request = initial.request
  }

  get activeCwd(): string {
    return this._activeCwd
  }

  get diffColumn(): number {
    return this._diffColumn
  }

  set diffColumn(value: number) {
    this._diffColumn = Math.max(0, value)
  }

  get diffScroll(): number {
    return this._diffScroll
  }

  set diffScroll(value: number) {
    this._diffScroll = Math.max(0, value)
  }

  get document(): DiffDocument {
    return this._document
  }

  get failedTarget(): DocumentLoadFailure | undefined {
    return this._failedTarget
  }

  get failure(): DocumentLoadFailure | undefined {
    return this._failure
  }

  get files(): DiffFile[] {
    return this.slice.files
  }

  get generation(): number {
    return this._generation
  }

  get reloadRequest(): DiffLoadRequest {
    return this._reloadRequest ?? this._request
  }

  get request(): DiffLoadRequest {
    return this._request
  }

  get selectedFileIndex(): number {
    return this._selectedFileIndex
  }

  set selectedFileIndex(value: number) {
    const maxIndex = Math.max(0, this.files.length - 1)
    const nextIndex = Math.max(0, Math.min(maxIndex, value))
    if (nextIndex !== this._selectedFileIndex) {
      this._diffColumn = 0
    }
    this._selectedFileIndex = nextIndex
  }

  get slice(): DiffSlice {
    return selectDiffSlice(this._document, this._workingTreeView)
  }

  get workingTreeView(): WorkingTreeView {
    return this._workingTreeView
  }

  captureSelection(preferredPath?: string): DocumentSelection {
    const selected = preferredPath
      ? this.files.find((file) => diffFileAliases(file).includes(preferredPath))
      : this.files[this._selectedFileIndex]
    const aliases = diffFileAliases(selected)
    return {
      preferredPath: preferredPath ?? selected?.path,
      aliases,
      status: selected?.status,
      stageState: selected?.stageState,
      untracked: selected?.untracked,
    }
  }

  replaceDocument(
    request: DiffLoadRequest,
    document: DiffDocument,
    selection: DocumentSelection = this.captureSelection(),
  ): void {
    this._document = document
    this._activeCwd = request.cwd
    this._request = request
    this._failedTarget = undefined
    this._failure = undefined
    this._reloadRequest = undefined
    this._generation += 1
    this._selectedFileIndex = this.selectionIndex(document, selection)
    this._diffColumn = 0
    this._diffScroll = 0
  }

  updateMetadata(document: DiffDocument): void {
    this._document = document
    this._failure = undefined
    this._failedTarget = undefined
    this._reloadRequest = undefined
  }

  recordLoadFailure(request: DiffLoadRequest, error: unknown): DocumentLoadFailure {
    const failure = documentLoadFailure(request, error)
    if (requestsMatch(request, this._request)) {
      this._failure = failure
      this._failedTarget = undefined
    } else {
      this._failedTarget = failure
    }
    this._reloadRequest = request
    this._diffColumn = 0
    this._diffScroll = 0
    return failure
  }

  abandonFailedTarget(): boolean {
    if (!this._failedTarget) {
      return false
    }
    this._failedTarget = undefined
    this._reloadRequest = undefined
    return true
  }

  setWorkingTreeView(view: WorkingTreeView): boolean {
    if (this._document.mode !== "working") {
      return false
    }
    if (this._workingTreeView === view) {
      return true
    }
    const selection = this.captureSelection()
    this._workingTreeView = view
    this._selectedFileIndex = this.selectionIndex(this._document, selection)
    this._diffColumn = 0
    this._diffScroll = 0
    return true
  }

  private selectionIndex(document: DiffDocument, selection: DocumentSelection): number {
    const files = selectDiffSlice(document, this._workingTreeView).files
    const aliases = new Set([selection.preferredPath, ...selection.aliases].filter((path): path is string => !!path))
    const firstTreeFile = buildTreeRows(files).find((row) => row.fileIndex !== undefined)?.fileIndex ?? 0
    if (aliases.size === 0) {
      return firstTreeFile
    }
    const candidates = files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => diffFileAliases(file).some((path) => aliases.has(path)))
    const exact = candidates.find(
      ({ file }) =>
        file.status === selection.status &&
        file.stageState === selection.stageState &&
        Boolean(file.untracked) === Boolean(selection.untracked),
    )
    return exact?.index ?? candidates[0]?.index ?? firstTreeFile
  }
}
