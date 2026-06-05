import { fit } from "./render-text.js"
import type { HelpContext } from "./types.js"
import { HELP_ACTIONS, HELP_TITLES, type HelpAction } from "./viewer-help.js"
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js"

export class DiffViewer extends DiffViewerWorktreePicker {
  protected renderOverlays(baseLines: string[], width: number): string[] {
    const renderedLines = this.renderActiveOverlay(baseLines, width)
    if (this.helpContext === undefined) {
      return renderedLines
    }
    return this.renderHelpOverlay(renderedLines, width)
  }

  protected renderActiveOverlay(baseLines: string[], width: number): string[] {
    if (this.hasFeatureOverlay()) {
      return this.renderFeatureOverlay(baseLines, width)
    }
    if (this.commitDialogState !== "closed") {
      return this.renderCommitDialogOverlay(baseLines, width)
    }
    if (this.commandMenuState !== "closed") {
      return this.renderCommandMenuOverlay(baseLines, width)
    }
    if (this.pickerState !== "closed") {
      return this.renderCommitPickerOverlay(baseLines, width)
    }
    return baseLines.map((line) => fit(line, width))
  }

  protected renderHelpOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.helpOverlayLines(layout.overlayWidth)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected helpOverlayLines(overlayWidth: number): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, overlayWidth)
    const context = this.helpContext ?? "viewer"
    return [
      this.commitPickerBorder("top", overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold(this.helpTitle(context)))}`),
      row(` ${this.theme.fg("dim", "press ? / esc / q to close help")}`),
      row(""),
      ...this.helpActions(context).map((action) => row(this.renderHelpAction(action))),
      row(""),
      this.commitPickerBorder("bottom", overlayWidth),
    ]
  }

  protected override currentHelpContext(): HelpContext {
    return this.featureHelpContext() ?? super.currentHelpContext()
  }

  protected helpTitle(context: HelpContext): string {
    return HELP_TITLES[context]
  }

  protected helpActions(context: HelpContext): HelpAction[] {
    return HELP_ACTIONS[context]
  }

  protected renderHelpAction(action: HelpAction): string {
    if (!action.keys) {
      return ` ${this.theme.fg("muted", action.action)}`
    }
    return ` ${this.theme.fg("accent", fit(action.keys, 14))} ${action.action}`
  }

  handleInput(data: string): void {
    if (
      this.handleHelpInput(data) ||
      this.handleFeatureOverlayInput(data) ||
      this.handleActiveOverlayInput(data) ||
      this.handleCloseInput(data) ||
      this.handleFeatureOpenInput(data) ||
      this.handleOpenOverlayInput(data)
    ) {
      return
    }
    this.handleViewerNavigationInput(data)
    this.requestRender()
  }

  invalidate(): void {
    // The viewer renders from current git data only; there is no cached external state to invalidate.
  }
}
