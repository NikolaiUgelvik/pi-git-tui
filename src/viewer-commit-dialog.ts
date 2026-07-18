import { matchesKey, visibleWidth } from "@earendil-works/pi-tui"
import { workingTreeHasConflicts } from "./diff-document.js"
import { generateCommitMessage, runGitCommit } from "./git.js"
import { createOverlayFrame, type OverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import { SingleLineTextField } from "./single-line-text-field.js"
import type { WorkingTreeDocument } from "./types.js"
import { viewerActionAvailability } from "./viewer-action-policy.js"
import { DiffViewerCommitPicker } from "./viewer-commit-picker.js"
import { isCommitGenerationInput } from "./viewer-key-input.js"

function conflictCommitReason(document: WorkingTreeDocument): string | undefined {
  return workingTreeHasConflicts(document) ? "Resolve conflicts before committing" : undefined
}

function amendCommitReason(document: WorkingTreeDocument, amend: boolean): string | undefined {
  if (!amend) {
    return
  }
  return document.headState === "unborn" ? "There is no commit to amend" : undefined
}

function normalCommitReason(document: WorkingTreeDocument, amend: boolean): string | undefined {
  if (amend) {
    return
  }
  return document.staged.stats.files === 0 ? "No staged changes to commit" : undefined
}

export class DiffViewerCommitDialog extends DiffViewerCommitPicker {
  private commitDialogEpoch = 0
  protected readonly commitMessageField = new SingleLineTextField("", "commit message")

  protected get commitMessage(): string {
    return this.commitMessageField.value
  }

  protected set commitMessage(value: string) {
    this.commitMessageField.setValue(value, "end")
  }

  protected override activeTextField(): SingleLineTextField | undefined {
    return this.commitDialogState === "open" ? this.commitMessageField : super.activeTextField()
  }

  protected openCommitDialog(): void {
    if (!this.requireViewerAction("commit")) {
      return
    }
    if (this.document.mode === "working") {
      this.documentState.setWorkingTreeView("staged")
    }
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
    this.commitMessageField.setValue(this.commitMessage, "end")
    this.commitDialogEpoch += 1
    this.commitDialogState = "open"
    this.requestRender()
  }

  protected handleCommitDialogInput(data: string): void {
    if (this.closeCommitDialogOnEscape(data) || this.commitDialogState === "loading") {
      return
    }
    this.updateCommitDialogInput(data)
    this.requestRender()
  }

  protected closeCommitDialogOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    const wasLoading = this.commitDialogState === "loading"
    const mutationMayHaveRun = ["commit", "amend commit"].includes(this.operationSnapshot().label ?? "")
    this.commitDialogEpoch += 1
    if (mutationMayHaveRun) {
      this.clearCommittedDialog()
    } else {
      this.commitDialogState = "closed"
    }
    this.loadingMessage = undefined
    if (wasLoading) {
      this.cancelActiveOperation()
    }
    this.requestRender()
    return true
  }

  protected updateCommitDialogInput(data: string): void {
    const handlers = [
      () => this.handleCommitAmendToggle(data),
      () => this.handleCommitMessageGeneration(data),
      () => this.handleCommitSubmission(data),
      () => this.commitMessageField.handleInput(data, "editor"),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleCommitAmendToggle(data: string): boolean {
    if (!matchesKey(data, "ctrl+x") && data !== "\x18") {
      return false
    }
    this.commitAmend = !this.commitAmend
    return true
  }

  protected handleCommitMessageGeneration(data: string): boolean {
    if (!isCommitGenerationInput(data)) {
      return false
    }
    if (this.document.mode !== "working" || this.document.staged.stats.files === 0) {
      this.error = "Stage changes before generating a commit message"
      this.errorDetails = this.error
      this.statusMessage = undefined
      return true
    }
    if (workingTreeHasConflicts(this.document)) {
      this.error = "Resolve conflicts before generating a commit message"
      this.errorDetails = this.error
      this.statusMessage = undefined
      return true
    }
    if (this.canStartForegroundOperation("generating a commit message")) {
      this.generateCommitMessageIntoDialog().catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected handleCommitSubmission(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const message = this.commitMessage.trim()
    if (!message) {
      this.error = "Commit message is empty"
      this.errorDetails = this.error
      this.statusMessage = undefined
      return true
    }
    const unavailable = this.commitUnavailableReason(this.commitAmend)
    if (unavailable) {
      this.error = unavailable
      this.errorDetails = unavailable
      this.statusMessage = undefined
      return true
    }
    if (this.canStartForegroundOperation("committing staged changes")) {
      this.commitStagedChanges(message).catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected async generateCommitMessageIntoDialog(): Promise<void> {
    const epoch = this.commitDialogEpoch
    this.commitDialogState = "loading"
    this.loadingMessage = "Generating commit message…"
    this.requestRender()
    const outcome = await this.runLoad<string>({
      label: "commit message generation",
      runningMessage: "Generating commit message…",
      load: ({ signal }) => this.requestGeneratedCommitMessage(signal),
      apply: (message) => {
        if (epoch !== this.commitDialogEpoch || this.commitDialogState === "closed") {
          return
        }
        this.commitMessageField.setValue(message, "end")
      },
    })
    if (epoch !== this.commitDialogEpoch) {
      return
    }
    this.commitDialogState = outcome.kind === "cancelled" || outcome.kind === "stale" ? "closed" : "open"
    this.loadingMessage = undefined
    this.requestRender()
  }

  protected requestGeneratedCommitMessage(signal: AbortSignal): Promise<string> {
    return generateCommitMessage(this.pi, this.activeContext(signal), { signal })
  }

  protected async commitStagedChanges(message: string): Promise<void> {
    if (!this.requireViewerAction("commit")) {
      this.commitDialogState = "closed"
      return
    }
    const unavailable = this.commitUnavailableReason(this.commitAmend)
    if (unavailable) {
      this.error = unavailable
      this.errorDetails = unavailable
      this.statusMessage = undefined
      this.commitDialogState = "open"
      this.requestRender()
      return
    }
    const epoch = this.commitDialogEpoch
    const cwd = this.activePath()
    const amend = this.commitAmend
    const selection = this.documentState.captureSelection()
    this.commitDialogState = "loading"
    this.loadingMessage = "Committing staged changes…"
    this.requestRender()
    const outcome = await this.runMutation({
      label: amend ? "amend commit" : "commit",
      runningMessage: "Committing staged changes…",
      mutate: ({ signal }) => runGitCommit(this.pi, cwd, message, signal, amend),
      successMessage: (output) => output,
      refresh: this.workingTreeRefreshIntent(cwd, selection),
      reconcileOnFailure: true,
    })
    if (epoch !== this.commitDialogEpoch) {
      return
    }
    if (outcome.kind === "mutationFailed") {
      this.commitDialogState = "open"
    } else if (outcome.kind === "rejected") {
      this.commitDialogState = "open"
      this.showOperationRejection("commit")
    } else {
      this.clearCommittedDialog()
    }
    this.loadingMessage = undefined
    this.requestRender()
  }

  protected commitUnavailableReason(amend: boolean): string | undefined {
    const availability = viewerActionAvailability(this.document, "commit")
    if (!availability.available) {
      return availability.reason
    }
    if (this.document.mode !== "working") {
      return "Return to the working tree with W before committing changes."
    }
    const reasons = [
      conflictCommitReason(this.document),
      amendCommitReason(this.document, amend),
      normalCommitReason(this.document, amend),
    ]
    return reasons.find((reason) => reason !== undefined)
  }

  private clearCommittedDialog(): void {
    this.commitMessageField.setValue("", "end")
    this.commitAmend = false
    this.commitDialogState = "closed"
  }

  protected renderCommitDialogOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const frame = createOverlayFrame(baseLines.length, width, this.theme)
    const overlay = this.commitDialogOverlayLines(frame)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected commitDialogOverlayLines(frame: OverlayFrame): string[] {
    const hint = frame.compact
      ? "Ctrl+X amend • Ctrl+G generate • Enter commit • Esc"
      : "type message • Ctrl+X amend • ←/→ move • Ctrl+G generate • enter commit • F1 help • esc cancel"
    return renderOverlayFrame(
      frame,
      ` ${this.theme.fg("accent", this.theme.bold(this.commitDialogTitle()))}`,
      ` ${this.theme.fg("dim", hint)}`,
      this.commitDialogBodyRows(frame.innerWidth),
    )
  }

  protected commitDialogTitle(): string {
    if (!this.commitAmend) {
      return "Commit staged changes"
    }
    return this.stagedFileCount() === 0 ? "Amend last commit · message/tree amend only" : "Amend last commit"
  }

  protected commitDialogBodyRows(innerWidth: number): string[] {
    if (this.commitDialogState === "loading") {
      return [` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`]
    }
    const mode = this.commitAmend ? this.theme.fg("warning", " amend") : this.theme.fg("muted", " normal")
    const stats =
      this.document.mode === "working" ? this.document.staged.stats : { files: 0, additions: 0, deletions: 0 }
    const staged = `${stats.files} file${stats.files === 1 ? "" : "s"} • +${stats.additions} −${stats.deletions}`
    return [
      ` Mode:${mode}`,
      ` Staged: ${this.theme.fg(stats.files > 0 ? "accent" : "warning", staged)}`,
      ` Message: ${this.renderCommitMessageInput(Math.max(1, innerWidth - visibleWidth(" Message: ")))}`,
    ]
  }

  protected stagedFileCount(): number {
    return this.document.mode === "working" ? this.document.staged.stats.files : 0
  }

  protected renderCommitMessageInput(width: number): string {
    return this.commitMessageField.render(
      width,
      this.commitMessageField.focused,
      this.theme.fg("muted", "commit message"),
    )
  }
}
