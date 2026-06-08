// Stash picker overlay controller.
// Uses FilterableListState<StashItem> for search/navigation/scroll.
// Rendering is pure; side effects (stashing, applying, popping, dropping) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import { FilterableListState, isEnter } from "./filterable-list-state.js"
import { createOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListInput, isCancelInput } from "./overlay-input.js"
import type { StashConfirm, StashSummary } from "./types.js"

// --- Types ---

export type StashAction = "stash-current" | "stash-item"
export type StashItem = { type: StashAction; stash?: StashSummary }

/** Callbacks the viewer provides to the controller for side effects. */
export interface StashPickerCallbacks {
  onStashCurrent: () => void
  onApply: (ref: string) => void
  onPop: (ref: string) => void
  onDrop: (ref: string) => void
  onClose: () => void
  onRequestRender: () => void
}

// --- Controller ---

export class StashPickerController {
  public list: FilterableListState<StashItem>
  public state: "closed" | "loading" | "open" | "confirm" = "closed"
  public loadingMessage: string | undefined
  public stashConfirmAction: StashConfirm | undefined
  public stashConfirmRef = ""

  private readonly _callbacks: StashPickerCallbacks
  private _rawStashes: StashSummary[] = []

  constructor(callbacks: StashPickerCallbacks) {
    this._callbacks = callbacks
    this.list = new FilterableListState<StashItem>([], (item) => {
      if (item.type === "stash-current") {
        return "stash current changes includes untracked"
      }
      return `${item.stash?.ref ?? ""} ${item.stash?.message ?? ""}`
    })
  }

  // --- Lifecycle ---

  public open(stashes: StashSummary[]): void {
    this.state = "open"
    this._rawStashes = stashes
    this.rebuildItems()
    this.list.reset()
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  public refreshStashes(stashes: StashSummary[]): void {
    this._rawStashes = stashes
    this.rebuildItems()
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  public close(): void {
    this.state = "closed"
    this.loadingMessage = undefined
    this.stashConfirmAction = undefined
    this.stashConfirmRef = ""
    this._callbacks.onClose()
    this._callbacks.onRequestRender()
  }

  public isOpen(): boolean {
    return this.state !== "closed"
  }

  private rebuildItems(): void {
    const stashItems = this._rawStashes.map((stash): StashItem => ({ type: "stash-item", stash }))
    this.list.items = [{ type: "stash-current" }, ...stashItems]
  }

  // --- Input handling ---

  public handleInput(data: string): void {
    if (this.state === "loading") {
      return
    }
    if (this.state === "confirm") {
      this.handleConfirmInput(data)
      this._callbacks.onRequestRender()
      return
    }
    if (isCancelInput(data)) {
      this.close()
      return
    }
    this.updatePickerInput(data)
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  private updatePickerInput(data: string): void {
    if (this.handlePop(data) || this.handleDrop(data)) {
      return
    }
    handleFilterableListInput(data, this.list, (item) => this.handleSelection(item))
  }

  private handlePop(data: string): boolean {
    if (!matchesKey(data, "ctrl+p") && data !== "\x10") {
      return false
    }
    return this.openConfirm("pop")
  }

  private handleDrop(data: string): boolean {
    if (!matchesKey(data, "ctrl+d") && data !== "\x04") {
      return false
    }
    return this.openConfirm("drop")
  }

  private openConfirm(action: StashConfirm): boolean {
    const item = this.list.get(this.list.selectedIndex)
    if (item?.type !== "stash-item" || !item.stash) {
      return true
    }
    this.stashConfirmAction = action
    this.stashConfirmRef = item.stash.ref
    this.state = "confirm"
    return true
  }

  private handleConfirmInput(data: string): void {
    if (isCancelInput(data)) {
      this.state = "open"
    } else if (isEnter(data)) {
      const ref = this.stashConfirmRef
      const action = this.stashConfirmAction
      if (action === "pop") {
        this._callbacks.onPop(ref)
      } else if (action === "drop") {
        this._callbacks.onDrop(ref)
      }
    }
  }

  private handleSelection(item: StashItem): void {
    if (item.type === "stash-current") {
      this._callbacks.onStashCurrent()
      return
    }
    if (item.stash) {
      this._callbacks.onApply(item.stash.ref)
    }
  }

  // --- Rendering (pure) ---

  public renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[] {
    const { maxItems, row, border } = createOverlayFrame(baseLineCount, width, theme)

    const title = this.stashTitle(theme)
    const hint = this.stashHint(theme)

    const lines: string[] = [
      border("top"),
      row(` ${theme.fg("accent", theme.bold(title))}`),
      row(` ${theme.fg("dim", hint)}`),
      ...this.renderBodyRows(maxItems, theme),
      row(""),
      border("bottom"),
    ]
    return lines
  }

  private stashTitle(_theme: Theme): string {
    if (this.state === "confirm") {
      return this.stashConfirmAction === "pop" ? "Pop stash?" : "Drop stash?"
    }
    return "Stashes"
  }

  private stashHint(_theme: Theme): string {
    return "enter stash/apply • Ctrl+P pop • Ctrl+D drop • ? help • esc cancel"
  }

  private renderBodyRows(maxItems: number, theme: Theme): string[] {
    if (this.state === "loading") {
      return ["", ` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    }
    if (this.state === "confirm") {
      return ["", ` ${this.stashTitle(theme)} ${this.stashConfirmRef}`, theme.fg("warning", " Enter OK • Esc/q Cancel")]
    }
    return [this.renderSearchLine(theme), "", ...this.renderStashItems(maxItems, theme)]
  }

  private renderSearchLine(theme: Theme): string {
    const query =
      this.list.searchQuery.length > 0 ? `${this.list.searchQuery}▌` : theme.fg("muted", "type to filter stashes")
    return ` Search: ${query}`
  }

  private renderStashItems(maxItems: number, theme: Theme): string[] {
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      return [` ${theme.fg("muted", "No matching stashes")}`]
    }
    const items = this.list.visibleItems(maxItems)
    return items.map(({ item, index }) => this.renderStashRow(item, index, theme))
  }

  private renderStashRow(item: StashItem, index: number, theme: Theme): string {
    const selected = index === this.list.selectedIndex
    const marker = selected ? "▶" : " "
    const line = this.stashRowLine(item, marker, theme)
    return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`
  }

  private stashRowLine(item: StashItem, marker: string, theme: Theme): string {
    if (item.type === "stash-current") {
      return `${marker} ${theme.fg("accent", "stash current changes")} ${theme.fg("muted", "includes untracked")}`
    }
    const stash = item.stash
    return `${marker} ${theme.fg("accent", stash?.ref ?? "stash")} ${stash?.message ?? ""}`
  }
}
