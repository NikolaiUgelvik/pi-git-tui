import { matchesKey } from "@earendil-works/pi-tui"
import { loadCommits } from "./git.js"
import { createTag, listTags } from "./git-extras.js"
import { type TagCreation, TagPickerController, type TagPickerState } from "./tag-picker-controller.js"
import type { TagSummary } from "./types.js"
import type { RefreshIntent } from "./viewer-operation-coordinator.js"
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js"

export class DiffViewerTagPicker extends DiffViewerWorktreePicker {
  protected tagPickerController: TagPickerController

  constructor(...args: ConstructorParameters<typeof DiffViewerWorktreePicker>) {
    super(...args)
    this.tagPickerController = new TagPickerController({
      onSelect: (tag) => void this.viewTag(tag).catch((error: unknown) => this.showAsyncError(error)),
      onRequestTargets: () => void this.loadTagTargets().catch((error: unknown) => this.showAsyncError(error)),
      onCreate: (creation) => void this.runTagCreate(creation).catch((error: unknown) => this.showAsyncError(error)),
      onValidationError: (message) => {
        this.error = message
        this.errorDetails = message
        this.statusMessage = undefined
      },
      onClose: () => this.cancelActiveOperation(),
      onRequestRender: () => this.requestRender(),
    })
    this.featureOverlays.register({
      kind: "tag",
      adapter: {
        isActive: () => this.tagPickerController.state !== "closed",
        activeTextField: () => this.tagPickerController.activeTextField(),
        helpContext: () => "tagPicker",
        render: (baseLines, width) => this.renderTagOverlay(baseLines, width),
        handleInput: (data) => this.handleTagInput(data),
        handleOpen: (data) => {
          if (data !== "t") return false
          if (this.requireViewerAction("tags") && this.canStartForegroundOperation("opening the tag picker")) {
            void this.loadTagList().catch((error: unknown) => this.showAsyncError(error))
          }
          return true
        },
        close: () => this.tagPickerController.close(),
      },
    })
  }

  protected get tagState(): TagPickerState {
    return this.tagPickerController.state
  }

  protected handleTagInput(data: string): void {
    if (this.tagPickerController.state === "loading") {
      if (matchesKey(data, "escape")) this.cancelTagOperation()
      return
    }
    this.tagPickerController.handleInput(data)
  }

  private cancelTagOperation(): void {
    if (this.tagPickerController.createTarget) {
      // Creation cancellation remains current until reconciliation determines
      // whether Git created the tag before observing the abort.
      this.tagPickerController.updateLoadingMessage("Cancelling tag creation…")
    } else {
      this.tagPickerController.cancelLoading()
    }
    this.cancelActiveOperation()
    this.requestRender()
  }

  private async loadTagList(): Promise<void> {
    if (!this.requireViewerAction("tags")) return
    const cwd = this.activePath()
    const request = this.tagPickerController.beginLoading("Loading tags…", "closed")
    this.requestRender()
    const outcome = await this.runLoad({
      label: "tag list",
      runningMessage: "Loading tags…",
      load: ({ signal }) => listTags(this.pi, cwd, signal),
      apply: (tags) => {
        if (this.tagPickerController.isCurrent(request)) this.tagPickerController.open(tags)
      },
    })
    if (!this.tagPickerController.isCurrent(request)) return
    this.tagPickerController.finishLoading(request, outcome.kind === "succeeded" ? "open" : "closed")
    this.requestRender()
  }

  private async loadTagTargets(): Promise<void> {
    if (!this.requireViewerAction("tags") || !this.canStartForegroundOperation("loading tag target commits")) return
    const cwd = this.activePath()
    const displayedCommit = this.document.mode === "commit" ? this.document.commit : undefined
    const request = this.tagPickerController.beginLoading("Loading target commits…", "open")
    this.requestRender()
    const outcome = await this.runLoad({
      label: "tag target commits",
      runningMessage: "Loading target commits…",
      load: ({ signal }) => loadCommits(this.pi, cwd, signal),
      apply: (commits) => {
        if (!this.tagPickerController.isCurrent(request)) return
        const targets =
          displayedCommit && !commits.some((commit) => commit.hash === displayedCommit.hash)
            ? [displayedCommit, ...commits]
            : commits
        this.tagPickerController.openTargetSelection(targets)
      },
    })
    if (!this.tagPickerController.isCurrent(request)) return
    this.tagPickerController.finishLoading(request, outcome.kind === "succeeded" ? "target" : "open")
    this.requestRender()
  }

  private async viewTag(tag: TagSummary): Promise<void> {
    if (!this.requireViewerAction("tags")) return
    if (tag.targetType !== "commit") {
      const message = `${tag.name} points to a ${tag.targetType}, not a commit`
      this.error = message
      this.errorDetails = message
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    if (!this.canStartForegroundOperation("loading a tag")) return
    const request = this.tagPickerController.beginLoading(`Loading ${tag.name}…`, "open")
    this.requestRender()
    const outcome = await this.loadDocument(
      {
        kind: "commit",
        cwd: this.activePath(),
        commit: { hash: tag.targetHash, message: tag.targetSubject ?? tag.annotation ?? tag.name },
      },
      { runningMessage: `Loading ${tag.name}…`, successMessage: `Viewing tag ${tag.name}`, recordFailure: true },
    )
    if (!this.tagPickerController.isCurrent(request)) return
    this.tagPickerController.finishLoading(request, outcome.kind === "succeeded" ? "closed" : "open")
    this.requestRender()
  }

  private async runTagCreate(creation: TagCreation): Promise<void> {
    if (!this.requireViewerAction("tags") || !this.canStartForegroundOperation("creating a tag")) return
    const cwd = this.activePath()
    const request = this.tagPickerController.beginLoading(`Creating ${creation.name}…`, "create")
    this.requestRender()
    const outcome = await this.runMutation({
      label: "create tag",
      runningMessage: `Creating ${creation.name}…`,
      mutate: ({ signal }) =>
        createTag(this.pi, cwd, creation.name, creation.target.hash, creation.annotated, creation.message, signal),
      successMessage: (message) => message,
      refresh: this.tagListRefreshIntent(cwd, creation.name, request),
    })
    if (!this.tagPickerController.isCurrent(request)) return
    let nextState: Exclude<TagPickerState, "loading"> = "create"
    if (outcome.kind === "succeeded" || (outcome.kind === "cancelled" && this.tagPickerController.state === "open")) {
      nextState = "open"
    } else if (outcome.kind === "refreshFailed") {
      nextState = "closed"
    } else if (outcome.kind === "rejected") {
      this.showOperationRejection("create a tag")
    }
    this.tagPickerController.finishLoading(request, nextState)
    if (nextState === "open") this.tagPickerController.showTagList()
    this.requestRender()
  }

  private tagListRefreshIntent(
    cwd: string,
    expectedTagName: string,
    request: Parameters<TagPickerController["isCurrent"]>[0],
  ): RefreshIntent<TagSummary[]> {
    return {
      label: "tag list refresh",
      run: ({ signal }) => listTags(this.pi, cwd, signal),
      apply: (tags) => {
        if (!this.tagPickerController.isCurrent(request)) return
        this.tagPickerController.refreshTags(tags)
        if (tags.some((tag) => tag.name === expectedTagName)) this.tagPickerController.showTagList()
      },
    }
  }

  protected renderTagOverlay(baseLines: string[], width: number): string[] {
    return this.renderPickerOverlay(baseLines, width, (baseLineCount, overlayWidth) =>
      this.tagPickerController.renderOverlayLines(baseLineCount, overlayWidth, this.theme),
    )
  }
}
