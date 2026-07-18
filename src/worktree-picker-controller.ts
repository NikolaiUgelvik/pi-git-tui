// Worktree picker overlay controller.
// Uses FilterableListState<WorktreeSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching worktrees) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { FilterableListState } from "./filterable-list-state.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListControllerInput, resetFilterableList } from "./overlay-input.js"
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
    handleFilterableListControllerInput(data, {
      state: this.state,
      list: this.list,
      onEnter: (worktree) => this._callbacks.onSwitch(worktree),
      onClose: () => this.close(),
      onRequestRender: this._callbacks.onRequestRender,
    })
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
    const frame = createOverlayFrame(baseLineCount, width, theme)
    const hint = frame.compact
      ? "↑↓ move • Enter select • Esc close • F1"
      : "type search • ↑↓ navigate • enter select • F1 help • esc cancel"
    return renderOverlayFrame(
      frame,
      ` ${theme.fg("accent", theme.bold("Worktrees"))}`,
      ` ${theme.fg("dim", hint)}`,
      this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.compact, theme),
    )
  }

  private renderBodyRows(maxItems: number, innerWidth: number, compact: boolean, theme: Theme): string[] {
    if (this.state === "loading") {
      return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    }
    return [
      this.renderSearchLine(innerWidth, theme),
      ...(compact ? [] : [""]),
      ...this.renderWorktreeItems(maxItems, theme),
    ]
  }

  private renderSearchLine(innerWidth: number, theme: Theme): string {
    const prefix = " Search: "
    const field = this.list.searchField.render(
      Math.max(1, innerWidth - prefix.length),
      this.list.searchField.focused,
      theme.fg("muted", "type to filter worktrees"),
    )
    return `${prefix}${field}`
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
