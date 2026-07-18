// Commit picker overlay controller.
// Uses FilterableListState<CommitPickerItem> for search/navigation/scroll.
// Rendering is pure; side effects (loading diffs) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"
import { FilterableListState } from "./filterable-list-state.js"
import { createOverlayFrame, renderSearchOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListControllerInput, resetFilterableList } from "./overlay-input.js"
import type { CommitPickerItem, CommitSummary } from "./types.js"

// --- Types ---

/** Callbacks the viewer provides to the controller for side effects. */
export interface CommitPickerCallbacks {
  onSelectWorkingTree: () => void
  onSelectCommit: (commit: CommitSummary) => void
  onClose: () => void
  onRequestRender: () => void
}

// --- Controller ---

export class CommitPickerController {
  public list: FilterableListState<CommitPickerItem>
  public state: "closed" | "loading" | "open" = "closed"
  public loadingMessage: string | undefined
  public totalCommits = 0

  private readonly _callbacks: CommitPickerCallbacks

  constructor(callbacks: CommitPickerCallbacks) {
    this._callbacks = callbacks
    this.list = new FilterableListState<CommitPickerItem>([], (item) => {
      if (item.type === "working") {
        return "working tree staged unstaged"
      }
      return `${item.commit.hash} ${item.commit.message}`
    })
  }

  // --- Lifecycle ---

  public open(commits: CommitSummary[]): void {
    this.state = "open"
    this.totalCommits = commits.length
    const workingItem: CommitPickerItem = { type: "working" }
    const commitItems = commits.map((commit): CommitPickerItem => ({ type: "commit", commit }))
    this.list.items = [workingItem, ...commitItems]
    resetFilterableList(this.list, this._callbacks.onRequestRender)
  }

  public close(): void {
    this.loadingMessage = undefined
    this.state = "closed"
    this._callbacks.onClose()
    this._callbacks.onRequestRender()
  }

  public isOpen(): boolean {
    return this.state === "open" || this.state === "loading"
  }

  // --- Input handling ---

  public handleInput(data: string): void {
    handleFilterableListControllerInput(data, {
      state: this.state,
      list: this.list,
      onEnter: (item) => this.handleSelection(item),
      onClose: () => this.close(),
      onRequestRender: this._callbacks.onRequestRender,
    })
  }

  private handleSelection(item: CommitPickerItem): void {
    if (item.type === "working") {
      this._callbacks.onSelectWorkingTree()
      return
    }
    this._callbacks.onSelectCommit(item.commit)
  }

  // --- Rendering (pure) ---

  /**
   * Render the overlay lines. The caller merges them onto the base lines.
   * Matches the existing commit picker rendering behavior exactly.
   */
  public renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[] {
    const frame = createOverlayFrame(baseLineCount, width, theme)
    return renderSearchOverlayFrame(
      frame,
      theme,
      "Select commit",
      frame.compact
        ? "↑↓ move • Enter select • Esc close • F1"
        : "type search • backspace edit • ↑↓ navigate • enter select • F1 help • esc cancel",
      this.renderSearchLine(frame.innerWidth, theme),
      this.renderBodyRows(frame.maxItems, theme),
    )
  }

  private renderSearchLine(innerWidth: number, theme: Theme): string {
    const prefix = " Search: "
    const matchCount = this.getFilteredCommitCount()
    const countLabel =
      this.list.searchQuery.trim().length > 0 ? ` ${theme.fg("muted", `(${matchCount}/${this.totalCommits})`)}` : ""
    const fieldWidth = Math.max(1, innerWidth - visibleWidth(prefix) - visibleWidth(countLabel))
    const field = this.list.searchField.render(
      fieldWidth,
      this.list.searchField.focused,
      theme.fg("muted", "type to filter commits"),
    )
    return `${prefix}${field}${countLabel}`
  }

  private getFilteredCommitCount(): number {
    let count = 0
    for (const item of this.list.filteredItems) {
      if (item.type === "commit") count++
    }
    return count
  }

  private renderBodyRows(maxItems: number, theme: Theme): string[] {
    if (this.state === "loading") {
      return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    }
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      return [` ${theme.fg("muted", "No matching commits")}`]
    }
    const items = this.list.visibleItems(maxItems)
    return items.map(({ item, index }) => this.renderItemRow(item, index, theme))
  }

  private renderItemRow(item: CommitPickerItem, index: number, theme: Theme): string {
    const selected = index === this.list.selectedIndex
    const marker = selected ? "▶" : " "
    const line =
      item.type === "working"
        ? ` ${marker} ${theme.fg("accent", "working tree")} ${theme.fg("muted", "staged + unstaged")}`
        : ` ${marker} ${theme.fg("accent", item.commit.hash)} ${item.commit.message}`
    return selected ? theme.bg("selectedBg", line) : line
  }
}
