import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff } from "./git.js"
import { listWorktrees, type WorktreeSummary } from "./git-extras.js"
import type { HelpContext } from "./types.js"
import { DiffViewerStashPicker } from "./viewer-stash-picker.js"

export class DiffViewerWorktreePicker extends DiffViewerStashPicker {
  protected worktreeState: "closed" | "loading" | "open" = "closed"
  protected worktrees: WorktreeSummary[] = []
  protected worktreeSearchQuery = ""
  protected selectedWorktreeIndex = 0
  protected worktreeScroll = 0

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.worktreeState !== "closed") {
      return "worktreePicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.worktreeState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.worktreeState !== "closed") {
      return this.renderWorktreeOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.worktreeState !== "closed") {
      this.handleWorktreeInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "w") {
      this.openWorktreePicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openWorktreePicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before switching worktrees"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.worktreeState = "loading"
    this.loadingMessage = "Loading worktrees…"
    this.requestRender()
    try {
      this.worktrees = await listWorktrees(this.pi, this.activePath(), this.ctx.signal)
      this.worktreeState = "open"
      this.clampWorktreeSelection()
    } catch (error) {
      this.worktreeState = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleWorktreeInput(data: string): void {
    if (this.worktreeState === "loading") {
      return
    }
    if (this.closeWorktreeOnCancel(data)) {
      return
    }
    this.updateWorktreePickerInput(data)
    this.clampWorktreeSelection()
    this.requestRender()
  }

  protected closeWorktreeOnCancel(data: string): boolean {
    if (!matchesKey(data, "escape") && !this.isKey(data, "q")) {
      return false
    }
    this.worktreeState = "closed"
    this.requestRender()
    return true
  }

  protected updateWorktreePickerInput(data: string): void {
    const handlers = [
      () => this.handleWorktreeSearchBackspace(data),
      () => this.handleWorktreeSelectionMove(data),
      () => this.handleWorktreeSelection(data),
      () => this.handleWorktreeSearchText(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleWorktreeSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.worktreeSearchQuery = [...this.worktreeSearchQuery].slice(0, -1).join("")
    this.resetWorktreeScroll()
    return true
  }

  protected handleWorktreeSearchText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    this.worktreeSearchQuery += data
    this.resetWorktreeScroll()
    return true
  }

  protected handleWorktreeSelectionMove(data: string): boolean {
    const nextIndex = this.nextListSelectionIndex(data, this.selectedWorktreeIndex, this.worktreeItemCount())
    if (nextIndex === undefined) {
      return false
    }
    this.selectedWorktreeIndex = nextIndex
    return true
  }

  protected handleWorktreeSelection(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const worktree = this.worktreeItem(this.selectedWorktreeIndex)
    if (!worktree) {
      return true
    }
    this.switchToWorktree(worktree).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected async switchToWorktree(worktree: WorktreeSummary): Promise<void> {
    const previousPath = this.activePath()
    this.worktreeState = "loading"
    this.loadingMessage = `Loading ${worktree.path}…`
    this.requestRender()
    try {
      this.activeCwd = worktree.path
      this.document = await loadWorkingTreeDiff(this.pi, this.activeContext())
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
      this.statusMessage = `Viewing ${worktree.path}`
      this.worktreeState = "closed"
    } catch (error) {
      this.activeCwd = previousPath
      this.error = error instanceof Error ? error.message : String(error)
      this.worktreeState = "open"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected resetWorktreeScroll(): void {
    this.selectedWorktreeIndex = 0
    this.worktreeScroll = 0
  }

  protected clampWorktreeSelection(): void {
    this.selectedWorktreeIndex = Math.max(
      0,
      Math.min(Math.max(0, this.worktreeItemCount() - 1), this.selectedWorktreeIndex),
    )
  }

  protected worktreeItemCount(): number {
    return this.worktreeItems().length
  }

  protected worktreeItem(index: number): WorktreeSummary | undefined {
    return this.worktreeItems()[index]
  }

  protected worktreeItems(): WorktreeSummary[] {
    const tokens = this.searchTokens(this.worktreeSearchQuery)
    if (tokens.length === 0) {
      return this.worktrees
    }
    return this.worktrees.filter((worktree) => this.matchesSearch(this.worktreeSearchText(worktree), tokens))
  }

  protected worktreeSearchText(worktree: WorktreeSummary): string {
    return `${worktree.path} ${this.worktreeRefLabel(worktree)} ${worktree.head ?? ""}`
  }

  protected renderWorktreeOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    const overlay = [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Worktrees"))}`),
      row(` ${this.theme.fg("dim", "type search • ↑↓ navigate • enter select • ? help • esc cancel")}`),
      ...this.worktreeOverlayBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected worktreeOverlayBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.worktreeState === "loading") {
      return [row(""), row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    return [
      row(this.renderWorktreeSearchLine()),
      row(""),
      ...this.visibleWorktreeItems(maxItems).map(({ worktree, index }) =>
        row(this.renderWorktreeItem(worktree, index)),
      ),
    ]
  }

  protected renderWorktreeSearchLine(): string {
    const query = this.worktreeSearchQuery
      ? `${this.worktreeSearchQuery}▌`
      : this.theme.fg("muted", "type to filter worktrees")
    return ` Search: ${query}`
  }

  protected visibleWorktreeItems(maxItems: number): Array<{ worktree: WorktreeSummary; index: number }> {
    this.worktreeScroll = this.nextListScroll(
      this.selectedWorktreeIndex,
      this.worktreeScroll,
      this.worktreeItemCount(),
      maxItems,
    )
    return this.worktreeItems()
      .slice(this.worktreeScroll, this.worktreeScroll + maxItems)
      .map((worktree, offset) => ({ worktree, index: this.worktreeScroll + offset }))
  }

  protected renderWorktreeItem(worktree: WorktreeSummary, index: number): string {
    const selected = index === this.selectedWorktreeIndex
    const marker = selected ? "▶" : " "
    const current = worktree.path === this.activePath() ? this.theme.fg("success", " current") : ""
    const line = ` ${marker} ${this.theme.fg("accent", worktree.path)} ${this.theme.fg("muted", this.worktreeRefLabel(worktree))}${current}`
    return selected ? this.theme.bg("selectedBg", line) : line
  }

  protected worktreeRefLabel(worktree: WorktreeSummary): string {
    if (worktree.branch) {
      return worktree.branch
    }
    if (worktree.detached) {
      return `detached ${worktree.head ?? "HEAD"}`
    }
    if (worktree.bare) {
      return "bare"
    }
    return worktree.head ?? "HEAD"
  }
}
