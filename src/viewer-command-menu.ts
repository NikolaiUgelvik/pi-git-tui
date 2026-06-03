import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff, runGitCommand } from "./git.js"
import { GIT_COMMANDS, type GitCommand } from "./types.js"
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js"

export class DiffViewerCommandMenu extends DiffViewerCommitDialog {
  protected openCommandMenu(): void {
    this.error = undefined
    this.statusMessage = undefined
    this.commandMenuState = "open"
    this.clampCommandSelection()
    this.requestRender()
  }

  protected handleCommandMenuInput(data: string): void {
    if (this.closeCommandMenuOnEscape(data) || this.commandMenuState === "loading") {
      return
    }
    this.updateCommandMenuInput(data)
    this.clampCommandSelection()
    this.requestRender()
  }

  protected closeCommandMenuOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.commandMenuState = "closed"
    this.requestRender()
    return true
  }

  protected updateCommandMenuInput(data: string): void {
    const handlers = [
      () => this.handleCommandSearchBackspace(data),
      () => this.handleCommandSearchText(data),
      () => this.handleCommandSelectionMove(data),
      () => this.handleCommandSelection(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleCommandSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.commandMenuSearchQuery = [...this.commandMenuSearchQuery].slice(0, -1).join("")
    this.resetCommandMenuScroll()
    return true
  }

  protected handleCommandSearchText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    this.commandMenuSearchQuery += data
    this.resetCommandMenuScroll()
    return true
  }

  protected handleCommandSelectionMove(data: string): boolean {
    const nextIndex = this.nextListSelectionIndex(data, this.selectedCommandIndex, this.commandMenuItemCount())
    if (nextIndex === undefined) {
      return false
    }
    this.selectedCommandIndex = nextIndex
    return true
  }

  protected handleCommandSelection(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const command = this.commandMenuItem(this.selectedCommandIndex)
    if (!command) {
      return false
    }
    this.runSelectedCommand(command).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected resetCommandMenuScroll(): void {
    this.selectedCommandIndex = 0
    this.commandMenuScroll = 0
  }

  protected clampCommandSelection(): void {
    this.selectedCommandIndex = Math.max(
      0,
      Math.min(Math.max(0, this.commandMenuItemCount() - 1), this.selectedCommandIndex),
    )
  }

  protected commandMenuItemCount(): number {
    return this.commandMenuItems().length
  }

  protected commandMenuItem(index: number): GitCommand | undefined {
    return this.commandMenuItems()[index]
  }

  protected commandMenuItems(): GitCommand[] {
    const tokens = this.searchTokens(this.commandMenuSearchQuery)
    if (tokens.length === 0) {
      return GIT_COMMANDS
    }
    return GIT_COMMANDS.filter((command) =>
      this.matchesSearch(`${command.label} ${command.description} git ${command.args.join(" ")}`, tokens),
    )
  }

  protected async runSelectedCommand(command: GitCommand): Promise<void> {
    this.commandMenuState = "loading"
    this.loadingMessage = `Running ${command.label}…`
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      const message = await runGitCommand(this.pi, this.ctx.cwd, command, this.ctx.signal)
      await this.refreshDocumentAfterCommand(command)
      this.statusMessage = message
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      await this.refreshDocumentAfterFailedCommand(command)
    } finally {
      this.commandMenuState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async refreshDocumentAfterCommand(command: GitCommand): Promise<void> {
    if (!command.refreshDiff || this.document.mode !== "working") {
      return
    }
    this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
    this.resetSelectionToFirstTreeFile()
  }

  protected async refreshDocumentAfterFailedCommand(command: GitCommand): Promise<void> {
    try {
      await this.refreshDocumentAfterCommand(command)
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      this.error = `${this.error}; refresh failed: ${message}`
    }
  }

  protected renderCommandMenuOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commandMenuOverlayLines(layout)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected commandMenuOverlayLines(layout: { overlayWidth: number; maxItems: number }): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    return [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Command menu"))}`),
      row(` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter run • ? help • esc cancel")}`),
      row(this.renderCommandSearchLine()),
      row(""),
      ...this.commandMenuBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
  }

  protected renderCommandSearchLine(): string {
    const query =
      this.commandMenuSearchQuery.length > 0
        ? `${this.commandMenuSearchQuery}▌`
        : this.theme.fg("muted", "type to filter commands")
    const countLabel =
      this.commandMenuSearchQuery.trim().length > 0
        ? ` ${this.theme.fg("muted", `(${this.commandMenuItemCount()}/${GIT_COMMANDS.length})`)}`
        : ""
    return ` Search: ${query}${countLabel}`
  }

  protected commandMenuBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.commandMenuState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Running…")}`)]
    }
    this.clampCommandSelection()
    if (this.commandMenuItemCount() === 0) {
      return [row(` ${this.theme.fg("muted", "No matching commands")}`)]
    }
    return this.visibleCommandMenuItems(maxItems).map(({ command, index }) =>
      row(this.renderCommandMenuItem(command, index)),
    )
  }

  protected visibleCommandMenuItems(maxItems: number): Array<{ command: GitCommand; index: number }> {
    this.updateCommandMenuScroll(maxItems)
    const visibleItems: Array<{ command: GitCommand; index: number }> = []
    const end = Math.min(this.commandMenuItemCount(), this.commandMenuScroll + maxItems)
    for (let index = this.commandMenuScroll; index < end; index++) {
      const command = this.commandMenuItem(index)
      if (command) {
        visibleItems.push({ command, index })
      }
    }
    return visibleItems
  }

  protected updateCommandMenuScroll(maxItems: number): void {
    this.commandMenuScroll = this.nextListScroll(
      this.selectedCommandIndex,
      this.commandMenuScroll,
      this.commandMenuItemCount(),
      maxItems,
    )
  }

  protected renderCommandMenuItem(command: GitCommand, index: number): string {
    const selected = index === this.selectedCommandIndex
    const marker = selected ? "▶" : " "
    const line = ` ${marker} ${this.theme.fg("accent", command.label)} ${this.theme.fg("muted", command.description)}`
    return selected ? this.theme.bg("selectedBg", line) : line
  }
}
