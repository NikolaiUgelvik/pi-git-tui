import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff } from "./git.js"
import { discardFileChanges, initializeGitRepository } from "./git-extras.js"
import type { DiffFile, HelpContext } from "./types.js"
import { DiffViewerCommandMenu } from "./viewer-command-menu.js"

export type ConfirmAction = "init" | "discard"

export class DiffViewerActions extends DiffViewerCommandMenu {
  protected confirmState: "closed" | "open" | "loading" = "closed"
  protected confirmAction: ConfirmAction | undefined
  protected confirmFile: DiffFile | undefined

  protected featureHelpContext(): HelpContext | undefined {
    return this.confirmState !== "closed" ? "confirmDialog" : undefined
  }

  protected hasFeatureOverlay(): boolean {
    return this.confirmState !== "closed"
  }

  protected renderFeatureOverlay(baseLines: string[], width: number): string[] {
    return this.renderConfirmOverlay(baseLines, width)
  }

  protected handleFeatureOverlayInput(data: string): boolean {
    if (this.confirmState === "closed") {
      return false
    }
    this.handleConfirmInput(data)
    return true
  }

  protected handleFeatureOpenInput(data: string): boolean {
    return this.handleOpenInitDialogInput(data) || this.handleOpenDiscardDialogInput(data)
  }

  protected handleOpenInitDialogInput(data: string): boolean {
    if (data !== "I") {
      return false
    }
    if (this.document.repositoryState !== "missing") {
      return true
    }
    this.error = undefined
    this.statusMessage = undefined
    this.confirmAction = "init"
    this.confirmFile = undefined
    this.confirmState = "open"
    this.requestRender()
    return true
  }

  protected handleOpenDiscardDialogInput(data: string): boolean {
    if (data !== "D") {
      return false
    }
    if (this.document.mode !== "working") {
      this.error = "Discard is only available in the working tree"
      this.statusMessage = undefined
      this.requestRender()
      return true
    }
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      return true
    }
    this.error = undefined
    this.statusMessage = undefined
    this.confirmAction = "discard"
    this.confirmFile = file
    this.confirmState = "open"
    this.requestRender()
    return true
  }

  protected handleConfirmInput(data: string): void {
    if (this.confirmState === "loading") {
      return
    }
    if (this.isConfirmCancel(data)) {
      this.closeConfirmDialog()
      return
    }
    if (this.isEnter(data)) {
      this.runConfirmedAction().catch((error: unknown) => this.showAsyncError(error))
    }
  }

  protected isConfirmCancel(data: string): boolean {
    return matchesKey(data, "escape") || this.isKey(data, "q")
  }

  protected closeConfirmDialog(): void {
    this.confirmState = "closed"
    this.confirmAction = undefined
    this.confirmFile = undefined
    this.requestRender()
  }

  protected async runConfirmedAction(): Promise<void> {
    const action = this.confirmAction
    this.confirmState = "loading"
    this.loadingMessage = this.confirmLoadingMessage()
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      this.statusMessage = await this.executeConfirmedAction(action)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.confirmState = "closed"
      this.confirmAction = undefined
      this.confirmFile = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.confirmState = "open"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected executeConfirmedAction(action: ConfirmAction | undefined): Promise<string> {
    if (action === "init") {
      return initializeGitRepository(this.pi, this.ctx.cwd, this.ctx.signal)
    }
    if (action === "discard" && this.confirmFile) {
      return discardFileChanges(this.pi, this.ctx.cwd, this.confirmFile, this.ctx.signal)
    }
    return Promise.reject(new Error("No confirmed action selected"))
  }

  protected confirmLoadingMessage(): string {
    return this.confirmAction === "init"
      ? "Initializing git repository…"
      : `Discarding ${this.confirmFile?.path ?? "file"}…`
  }

  protected renderConfirmOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    const overlay = [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold(this.confirmTitle()))}`),
      row(` ${this.theme.fg("dim", "Enter OK • Esc/q Cancel • ? help")}`),
      row(""),
      ...this.confirmBodyRows(row),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected confirmTitle(): string {
    if (this.confirmState === "loading") {
      return this.loadingMessage ?? "Working…"
    }
    return this.confirmAction === "init" ? "Initialize git repository" : "Discard selected file changes"
  }

  protected confirmBodyRows(row: (content: string) => string): string[] {
    if (this.confirmState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`)]
    }
    if (this.confirmAction === "init") {
      return [row(` Initialize git repo in ${this.ctx.cwd}?`), row(""), row(" [ OK ]   [ Cancel ]")]
    }
    return [
      row(` Discard all staged and unstaged changes for ${this.confirmFile?.path ?? "file"}?`),
      row(this.theme.fg("warning", " This cannot be undone.")),
      row(""),
      row(" [ OK ]   [ Cancel ]"),
    ]
  }
}
