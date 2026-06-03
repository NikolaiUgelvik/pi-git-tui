import { matchesKey } from "@earendil-works/pi-tui"
import { generateCommitMessage, loadWorkingTreeDiff, runGitCommit } from "./git.js"
import { DiffViewerCommitPicker } from "./viewer-commit-picker.js"

export class DiffViewerCommitDialog extends DiffViewerCommitPicker {
  protected openCommitDialog(): void {
    this.error = undefined
    this.statusMessage = undefined
    this.commitMessageCaret = this.commitMessageLength()
    this.commitDialogState = "open"
    this.requestRender()
  }

  protected handleCommitDialogInput(data: string): void {
    if (this.commitDialogState === "loading" || this.closeCommitDialogOnEscape(data)) {
      return
    }
    this.updateCommitDialogInput(data)
    this.requestRender()
  }

  protected closeCommitDialogOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.commitDialogState = "closed"
    this.requestRender()
    return true
  }

  protected updateCommitDialogInput(data: string): void {
    const handlers = [
      () => this.handleCommitMessageGeneration(data),
      () => this.handleCommitMessageCaretMove(data),
      () => this.handleCommitMessageBackspace(data),
      () => this.handleCommitMessageDelete(data),
      () => this.handleCommitSubmission(data),
      () => this.handleCommitMessageText(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected commitMessageChars(): string[] {
    return [...this.commitMessage]
  }

  protected commitMessageLength(): number {
    return this.commitMessageChars().length
  }

  protected clampCommitMessageCaret(chars = this.commitMessageChars()): number {
    this.commitMessageCaret = Math.max(0, Math.min(this.commitMessageCaret, chars.length))
    return this.commitMessageCaret
  }

  protected setCommitMessageChars(chars: string[]): void {
    this.commitMessage = chars.join("")
    this.clampCommitMessageCaret(chars)
  }

  protected handleCommitMessageGeneration(data: string): boolean {
    if (data !== "*") {
      return false
    }
    this.generateCommitMessageIntoDialog().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleCommitMessageCaretMove(data: string): boolean {
    const chars = this.commitMessageChars()
    this.clampCommitMessageCaret(chars)
    if (matchesKey(data, "left")) {
      this.commitMessageCaret = Math.max(0, this.commitMessageCaret - 1)
      return true
    }
    if (matchesKey(data, "right")) {
      this.commitMessageCaret = Math.min(chars.length, this.commitMessageCaret + 1)
      return true
    }
    if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
      this.commitMessageCaret = 0
      return true
    }
    if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
      this.commitMessageCaret = chars.length
      return true
    }
    return false
  }

  protected handleCommitMessageBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    const chars = this.commitMessageChars()
    const caret = this.clampCommitMessageCaret(chars)
    if (caret > 0) {
      chars.splice(caret - 1, 1)
      this.commitMessageCaret = caret - 1
      this.setCommitMessageChars(chars)
    }
    return true
  }

  protected handleCommitMessageDelete(data: string): boolean {
    if (!matchesKey(data, "delete") && data !== "\x1b[3~") {
      return false
    }
    const chars = this.commitMessageChars()
    const caret = this.clampCommitMessageCaret(chars)
    if (caret < chars.length) {
      chars.splice(caret, 1)
      this.setCommitMessageChars(chars)
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
      this.statusMessage = undefined
      return true
    }
    this.commitStagedChanges(message).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected handleCommitMessageText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    const chars = this.commitMessageChars()
    const input = [...data]
    const caret = this.clampCommitMessageCaret(chars)
    chars.splice(caret, 0, ...input)
    this.commitMessageCaret = caret + input.length
    this.setCommitMessageChars(chars)
    return true
  }

  protected async generateCommitMessageIntoDialog(): Promise<void> {
    this.commitDialogState = "loading"
    this.loadingMessage = "Generating commit message…"
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      this.commitMessage = await generateCommitMessage(this.pi, this.ctx)
      this.commitMessageCaret = this.commitMessageLength()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.commitDialogState = "open"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async commitStagedChanges(message: string): Promise<void> {
    this.commitDialogState = "loading"
    this.loadingMessage = "Committing staged changes…"
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      const output = await runGitCommit(this.pi, this.ctx.cwd, message, this.ctx.signal)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.commitMessage = ""
      this.commitMessageCaret = 0
      this.commitDialogState = "closed"
      this.statusMessage = output
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.commitDialogState = "open"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected renderCommitDialogOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitDialogOverlayLines(layout.overlayWidth)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected commitDialogOverlayLines(overlayWidth: number): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, overlayWidth)
    return [
      this.commitPickerBorder("top", overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Commit staged changes"))}`),
      row(` ${this.theme.fg("dim", "type message • ←/→ move • * generate • enter commit • ? help • esc cancel")}`),
      row(""),
      ...this.commitDialogBodyRows(row),
      row(""),
      this.commitPickerBorder("bottom", overlayWidth),
    ]
  }

  protected commitDialogBodyRows(row: (content: string) => string): string[] {
    if (this.commitDialogState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`)]
    }
    return [row(` Message: ${this.renderCommitMessageInput()}`)]
  }

  protected renderCommitMessageInput(): string {
    const chars = this.commitMessageChars()
    const caret = this.clampCommitMessageCaret(chars)
    if (chars.length === 0) {
      return `▌${this.theme.fg("muted", "commit message")}`
    }
    return `${chars.slice(0, caret).join("")}▌${chars.slice(caret).join("")}`
  }
}
