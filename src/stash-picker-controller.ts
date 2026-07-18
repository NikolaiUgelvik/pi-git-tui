// Stash picker overlay controller.
// Uses FilterableListState<StashItem> for search/navigation/scroll.
// Rendering is pure; side effects (stashing, applying, popping, dropping) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import {
  type ConfirmationPrompt,
  confirmationBodyLines,
  confirmationDecision,
  confirmationHint,
} from "./confirmation-prompt.js"
import { FilterableListState } from "./filterable-list-state.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js"
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
  onRetryList: () => void
  onClose: () => void
  onRequestRender: () => void
}

// --- Controller ---

export class StashPickerController {
  public list: FilterableListState<StashItem>
  public state: "closed" | "loading" | "open" | "confirm" = "closed"
  public loadingMessage: string | undefined
  public warning: string | undefined
  public stashConfirmAction: StashConfirm | undefined
  public stashConfirmItem: StashSummary | undefined

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

  get stashConfirmRef(): string {
    return this.stashConfirmItem?.ref ?? ""
  }

  public clearStashConfirmation(): void {
    this.stashConfirmAction = undefined
    this.stashConfirmItem = undefined
  }

  // --- Lifecycle ---

  public open(stashes: StashSummary[]): void {
    this.state = "open"
    this.warning = undefined
    this._rawStashes = stashes
    this.rebuildItems()
    this.list.reset()
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  public refreshStashes(stashes: StashSummary[]): void {
    this.warning = undefined
    this._rawStashes = stashes
    this.rebuildItems()
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  public showListWarning(message: string): void {
    this.warning = message
    this.state = "open"
    this._callbacks.onRequestRender()
  }

  public close(): void {
    this.state = "closed"
    this.loadingMessage = undefined
    this.warning = undefined
    this.clearStashConfirmation()
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
    if (this.state === "confirm") {
      this.handleConfirmInput(data)
      this._callbacks.onRequestRender()
      return
    }
    if (isEscapeInput(data)) {
      this.close()
      return
    }
    if (this.state === "loading") {
      return
    }
    if (this.warning && data === "r") {
      this._callbacks.onRetryList()
      this._callbacks.onRequestRender()
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
    this.stashConfirmItem = item.stash
    this.state = "confirm"
    return true
  }

  private handleConfirmInput(data: string): void {
    const decision = confirmationDecision(data)
    if (decision === "cancel") {
      this.state = "open"
      return
    }
    if (decision !== "confirm") {
      return
    }
    const ref = this.stashConfirmRef
    const action = this.stashConfirmAction
    if (action === "pop") {
      this._callbacks.onPop(ref)
    } else if (action === "drop") {
      this._callbacks.onDrop(ref)
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
    const frame = createOverlayFrame(baseLineCount, width, theme)
    const title = this.stashTitle(theme)
    const hint = this.stashHint(theme, frame.compact)
    return renderOverlayFrame(
      frame,
      ` ${theme.fg("accent", theme.bold(title))}`,
      ` ${theme.fg("dim", hint)}`,
      this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.bodyRows, frame.compact, theme),
    )
  }

  private stashTitle(_theme: Theme): string {
    return this.state === "confirm" ? this.stashConfirmationPrompt().title : "Stashes"
  }

  private stashHint(_theme: Theme, compact: boolean): string {
    if (this.state === "confirm") {
      return confirmationHint(this.stashConfirmationPrompt())
    }
    return compact
      ? "Enter apply • Ctrl+P pop • Ctrl+D drop • Esc"
      : "enter stash/apply • Ctrl+P pop • Ctrl+D drop • F1 help • esc cancel"
  }

  private renderBodyRows(
    maxItems: number,
    innerWidth: number,
    bodyRows: number,
    compact: boolean,
    theme: Theme,
  ): string[] {
    if (this.state === "loading") {
      return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    }
    if (this.state === "confirm") {
      return confirmationBodyLines(this.stashConfirmationPrompt(), theme, {
        compact,
        maxRows: bodyRows,
        width: innerWidth,
      })
    }
    const warning = this.warning ? [` ${theme.fg("warning", this.warning)} • r retry list`] : []
    const spacing = compact ? [] : [""]
    const itemRows = Math.max(0, maxItems - warning.length)
    return [this.renderSearchLine(innerWidth, theme), ...spacing, ...warning, ...this.renderStashItems(itemRows, theme)]
  }

  private stashConfirmationPrompt(): ConfirmationPrompt {
    const stash = this.stashConfirmItem
    const details = [`Stash: ${stash?.ref ?? "selected stash"}`, `Message: ${stash?.message ?? ""}`]
    if (this.stashConfirmAction === "pop") {
      return {
        title: "Pop stash?",
        details,
        consequence:
          "Applies changes and removes the stash only after a successful application. Conflicts may modify the working tree.",
        confirmLabel: "Pop stash",
      }
    }
    return {
      title: "Drop stash?",
      details,
      consequence: "Permanently deletes this stash. This cannot be undone.",
      confirmLabel: "Drop stash",
    }
  }

  private renderSearchLine(innerWidth: number, theme: Theme): string {
    const prefix = " Search: "
    const field = this.list.searchField.render(
      Math.max(1, innerWidth - prefix.length),
      this.list.searchField.focused,
      theme.fg("muted", "type to filter stashes"),
    )
    return `${prefix}${field}`
  }

  private renderStashItems(maxItems: number, theme: Theme): string[] {
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      return [` ${theme.fg("muted", "No matching stashes")}`]
    }
    if (maxItems <= 0) {
      return []
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
