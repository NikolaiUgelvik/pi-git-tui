// Worktree picker overlay controller.
// Uses FilterableListState<WorktreeSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching worktrees) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { FilterableListState } from "./filterable-list-state.js"
import { createOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListInput, isCancelInput, resetFilterableList } from "./overlay-input.js"
import type { WorktreeSummary } from "./types.js"

// --- Types ---

/** Callbacks the viewer provides to the controller for side effects. */
export interface WorktreePickerCallbacks {
  onSwitch: (worktree: WorktreeSummary) => void
  onClose: () => void
  onRequestRender: () => void
}

// --- Controller ---

export class WorktreePickerController {
  public list: FilterableListState<WorktreeSummary>
  public state: "closed" | "loading" | "open" = "closed"
  public loadingMessage: string | undefined
  public activePath = ""

  private readonly _callbacks: WorktreePickerCallbacks

  constructor(callbacks: WorktreePickerCallbacks) {
    this._callbacks = callbacks
    this.list = new FilterableListState<WorktreeSummary>([], (worktree) => this.searchText(worktree))
  }

  // --- Lifecycle ---

  public open(worktrees: WorktreeSummary[], activePath: string): void {
    this.state = "open"
    this.activePath = activePath
    this.list.items = worktrees
    resetFilterableList(this.list, this._callbacks.onRequestRender)
  }

  public close(): void {
    this.state = "closed"
    this.loadingMessage = undefined
    this._callbacks.onClose()
    this._callbacks.onRequestRender()
  }

  public isOpen(): boolean {
    return this.state === "open" || this.state === "loading"
  }

  // --- Input handling ---

  public handleInput(data: string): void {
    if (this.state === "loading") {
      return
    }
    if (isCancelInput(data)) {
      this.close()
      return
    }
    handleFilterableListInput(data, this.list, (worktree) => this._callbacks.onSwitch(worktree))
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  // --- Search helpers ---

  private searchText(worktree: WorktreeSummary): string {
    const refLabel = this.refLabel(worktree)
    return `${worktree.path} ${refLabel} ${worktree.head ?? ""}`
  }

  public refLabel(worktree: WorktreeSummary): string {
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

  // --- Rendering (pure) ---

  public renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[] {
    const { maxItems, row, border } = createOverlayFrame(baseLineCount, width, theme)

    const lines: string[] = [
      border("top"),
      row(` ${theme.fg("accent", theme.bold("Worktrees"))}`),
      row(` ${theme.fg("dim", "type search • ↑↓ navigate • enter select • ? help • esc cancel")}`),
      ...this.renderBodyRows(maxItems, theme),
      row(""),
      border("bottom"),
    ]
    return lines
  }

  private renderBodyRows(maxItems: number, theme: Theme): string[] {
    if (this.state === "loading") {
      return ["", ` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    }
    return [this.renderSearchLine(theme), "", ...this.renderWorktreeItems(maxItems, theme)]
  }

  private renderSearchLine(theme: Theme): string {
    const query =
      this.list.searchQuery.length > 0 ? `${this.list.searchQuery}▌` : theme.fg("muted", "type to filter worktrees")
    return ` Search: ${query}`
  }

  private renderWorktreeItems(maxItems: number, theme: Theme): string[] {
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      return [` ${theme.fg("muted", "No matching worktrees")}`]
    }
    const items = this.list.visibleItems(maxItems)
    return items.map(({ item, index }) => this.renderWorktreeRow(item, index, theme))
  }

  private renderWorktreeRow(worktree: WorktreeSummary, index: number, theme: Theme): string {
    const selected = index === this.list.selectedIndex
    const marker = selected ? "▶" : " "
    const current = worktree.path === this.activePath ? theme.fg("success", " current") : ""
    const line = `${marker} ${theme.fg("accent", worktree.path)} ${theme.fg("muted", this.refLabel(worktree))}${current}`
    return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`
  }
}
