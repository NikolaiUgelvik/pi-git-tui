import { fit } from "./render-text.js"
import type { HelpContext } from "./types.js"
import { DiffViewerCommandMenu } from "./viewer-command-menu.js"

export class DiffViewer extends DiffViewerCommandMenu {
  protected renderOverlays(baseLines: string[], width: number): string[] {
    const renderedLines = this.renderActiveOverlay(baseLines, width)
    if (this.helpContext === undefined) {
      return renderedLines
    }
    return this.renderHelpOverlay(renderedLines, width)
  }

  protected renderActiveOverlay(baseLines: string[], width: number): string[] {
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

  protected helpTitle(context: HelpContext): string {
    switch (context) {
      case "commitDialog":
        return "Commit dialog help"
      case "commandMenu":
        return "Command menu help"
      case "commitPicker":
        return "Commit picker help"
      case "viewer":
        return "Diff viewer help"
    }
  }

  protected helpActions(context: HelpContext): Array<{ keys?: string; action: string }> {
    switch (context) {
      case "commitDialog":
        return [
          { keys: "type", action: "Edit the commit message" },
          { keys: "←/→", action: "Move the commit message caret" },
          { keys: "Home/End", action: "Jump the caret to the start or end" },
          { keys: "Backspace/Delete", action: "Delete around the caret" },
          { keys: "*", action: "Generate a commit message from staged changes" },
          { keys: "Enter", action: "Commit staged changes with the message" },
          { keys: "Esc", action: "Cancel and close the commit dialog" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "commandMenu":
        return [
          { keys: "type", action: "Filter commands by label, description, or git args" },
          { keys: "Backspace", action: "Delete the previous search character" },
          { keys: "↑/↓", action: "Move to the previous or next command" },
          { keys: "PgUp/PgDn", action: "Jump through commands by page" },
          { keys: "Home/End", action: "Jump to the first or last command" },
          { keys: "Enter", action: "Run the selected git command" },
          { keys: "Esc", action: "Cancel and close the command menu" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "commitPicker":
        return [
          { keys: "type", action: "Filter commits by hash or message" },
          { keys: "Backspace", action: "Delete the previous search character" },
          { keys: "↑/↓", action: "Move to the previous or next entry" },
          { keys: "PgUp/PgDn", action: "Jump through entries by page" },
          { keys: "Home/End", action: "Jump to the first or last entry" },
          { keys: "Enter", action: "Select the working tree or highlighted commit" },
          { keys: "Esc", action: "Cancel and close the commit picker" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "viewer":
        return [
          { keys: "Tab", action: "Switch focus between the file tree and diff" },
          { keys: "↑/↓ or j/k", action: "Move files when focused on Files; scroll code in Diff" },
          { keys: "n / p", action: "Move to the next or previous file" },
          { keys: "Enter", action: "Stage or unstage the selected file in the working tree" },
          { keys: "PgUp/PgDn", action: "Scroll the diff by half a page" },
          { keys: "Space", action: "Scroll the diff down by half a page" },
          { keys: "Home/End", action: "Jump to the first or last file/line" },
          { keys: "c", action: "Open the commit picker" },
          { keys: "C", action: "Open the staged changes commit dialog" },
          { keys: "Ctrl+P", action: "Open the git command menu" },
          { keys: "Esc / q", action: "Close the diff viewer" },
          { keys: "?", action: "Show or close this help" },
        ]
    }
  }

  protected renderHelpAction(action: { keys?: string; action: string }): string {
    if (!action.keys) {
      return ` ${this.theme.fg("muted", action.action)}`
    }
    return ` ${this.theme.fg("accent", fit(action.keys, 14))} ${action.action}`
  }

  handleInput(data: string): void {
    if (
      this.handleHelpInput(data) ||
      this.handleActiveOverlayInput(data) ||
      this.handleCloseInput(data) ||
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
