import { matchesKey } from "@earendil-works/pi-tui"
import { loadCommitDiff, loadCommits, loadWorkingTreeDiff } from "./git.js"
import type { CommitPickerItem, CommitSummary } from "./types.js"
import { DiffViewerOverlayBase } from "./viewer-overlay-base.js"

export class DiffViewerCommitPicker extends DiffViewerOverlayBase {
  protected async openCommitPicker(): Promise<void> {
    this.error = undefined
    this.pickerState = "loading"
    this.loadingMessage = "Loading commits…"
    this.requestRender()
    try {
      this.commits = await loadCommits(this.pi, this.ctx.cwd, this.ctx.signal)
      this.pickerState = "open"
    } catch (error) {
      this.pickerState = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleCommitPickerInput(data: string): void {
    if (this.closeCommitPickerOnEscape(data) || this.pickerState === "loading") {
      return
    }
    this.updateCommitPickerInput(data)
    this.clampCommitSelection()
    this.requestRender()
  }

  protected closeCommitPickerOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.pickerState = "closed"
    this.requestRender()
    return true
  }

  protected updateCommitPickerInput(data: string): void {
    const handlers = [
      () => this.handleCommitSearchBackspace(data),
      () => this.handleCommitSearchText(data),
      () => this.handleCommitSelectionMove(data),
      () => this.handleCommitSelection(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleCommitSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.commitSearchQuery = [...this.commitSearchQuery].slice(0, -1).join("")
    this.resetCommitPickerScroll()
    return true
  }

  protected isBackspace(data: string): boolean {
    return matchesKey(data, "backspace") || data === "\b" || data === "\x7f"
  }

  protected handleCommitSearchText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    this.commitSearchQuery += data
    this.resetCommitPickerScroll()
    return true
  }

  protected handleCommitSelectionMove(data: string): boolean {
    const nextIndex = this.nextCommitSelectionIndex(data)
    if (nextIndex === undefined) {
      return false
    }
    this.selectedCommitIndex = nextIndex
    return true
  }

  protected nextCommitSelectionIndex(data: string): number | undefined {
    return this.nextListSelectionIndex(data, this.selectedCommitIndex, this.commitPickerItemCount())
  }

  protected handleCommitSelection(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const item = this.commitPickerItem(this.selectedCommitIndex)
    if (item?.type === "working") {
      this.selectWorkingTree().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    if (item?.type === "commit") {
      this.selectCommit(item.commit).catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return false
  }

  protected resetCommitPickerScroll(): void {
    this.selectedCommitIndex = 0
    this.commitScroll = 0
  }

  protected clampCommitSelection(): void {
    this.selectedCommitIndex = Math.max(
      0,
      Math.min(Math.max(0, this.commitPickerItemCount() - 1), this.selectedCommitIndex),
    )
  }

  protected commitPickerItemCount(): number {
    return this.commitPickerItems().length
  }

  protected commitPickerItem(index: number): CommitPickerItem | undefined {
    return this.commitPickerItems()[index]
  }

  protected commitPickerItems(): CommitPickerItem[] {
    const workingItem: CommitPickerItem = { type: "working" }
    const commitItems = this.commits.map((commit): CommitPickerItem => ({ type: "commit", commit }))
    const tokens = this.searchTokens(this.commitSearchQuery)
    if (tokens.length === 0) {
      return [workingItem, ...commitItems]
    }

    const items: CommitPickerItem[] = []
    if (this.matchesSearch("working tree staged unstaged", tokens)) {
      items.push(workingItem)
    }
    items.push(
      ...commitItems.filter(
        (item) => item.type === "commit" && this.matchesSearch(`${item.commit.hash} ${item.commit.message}`, tokens),
      ),
    )
    return items
  }

  protected async selectWorkingTree(): Promise<void> {
    this.pickerState = "loading"
    this.loadingMessage = "Loading working tree…"
    this.requestRender()
    try {
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.pickerState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected renderCommitSearchLine(): string {
    const query =
      this.commitSearchQuery.length > 0
        ? `${this.commitSearchQuery}▌`
        : this.theme.fg("muted", "type to filter commits")
    const matchCount = this.commitPickerItems().filter((item) => item.type === "commit").length
    const countLabel =
      this.commitSearchQuery.trim().length > 0
        ? ` ${this.theme.fg("muted", `(${matchCount}/${this.commits.length})`)}`
        : ""
    return ` Search: ${query}${countLabel}`
  }

  protected async selectCommit(commit: CommitSummary): Promise<void> {
    this.pickerState = "loading"
    this.loadingMessage = `Loading ${commit.hash}…`
    this.requestRender()
    try {
      this.document = await loadCommitDiff(this.pi, this.ctx.cwd, commit, this.ctx.signal)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.pickerState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected renderCommitPickerOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitPickerOverlayLines(layout)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected commitPickerOverlayLines(layout: { overlayWidth: number; maxItems: number }): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    return [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Select commit"))}`),
      row(
        ` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter select • ? help • esc cancel")}`,
      ),
      row(this.renderCommitSearchLine()),
      row(""),
      ...this.commitPickerBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
  }

  protected commitPickerBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.pickerState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    this.clampCommitSelection()
    if (this.commitPickerItemCount() === 0) {
      return [row(` ${this.theme.fg("muted", "No matching commits")}`)]
    }
    return this.visibleCommitPickerItems(maxItems).map(({ item, index }) =>
      row(this.renderCommitPickerItem(item, index)),
    )
  }

  protected visibleCommitPickerItems(maxItems: number): Array<{ item: CommitPickerItem; index: number }> {
    this.updateCommitScroll(maxItems)
    const visibleItems: Array<{ item: CommitPickerItem; index: number }> = []
    const end = Math.min(this.commitPickerItemCount(), this.commitScroll + maxItems)
    for (let index = this.commitScroll; index < end; index++) {
      const item = this.commitPickerItem(index)
      if (item) {
        visibleItems.push({ item, index })
      }
    }
    return visibleItems
  }

  protected updateCommitScroll(maxItems: number): void {
    this.commitScroll = this.nextListScroll(
      this.selectedCommitIndex,
      this.commitScroll,
      this.commitPickerItemCount(),
      maxItems,
    )
  }

  protected renderCommitPickerItem(item: CommitPickerItem, index: number): string {
    const selected = index === this.selectedCommitIndex
    const marker = selected ? "▶" : " "
    const line =
      item.type === "working" ? this.renderWorkingTreePickerItem(marker) : this.renderCommitPickerCommit(item, marker)
    return selected ? this.theme.bg("selectedBg", line) : line
  }

  protected renderWorkingTreePickerItem(marker: string): string {
    return ` ${marker} ${this.theme.fg("accent", "working tree")} ${this.theme.fg("muted", "staged + unstaged")}`
  }

  protected renderCommitPickerCommit(item: { type: "commit"; commit: CommitSummary }, marker: string): string {
    return ` ${marker} ${this.theme.fg("accent", item.commit.hash)} ${item.commit.message}`
  }
}
