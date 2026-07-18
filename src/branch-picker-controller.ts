// Branch picker overlay controller.
// Uses FilterableListState<BranchSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching/creating branches) go through callbacks.

import type { Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import { FilterableListState, isEnter } from "./filterable-list-state.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js"
import { SingleLineTextField } from "./single-line-text-field.js"
import type { BranchSummary } from "./types.js"

// --- Types ---

/** Callbacks the viewer provides to the controller for side effects. */
export interface BranchPickerCallbacks {
  onSwitch: (name: string) => void
  onCreate: (name: string) => void
  onValidationError: (message: string) => void
  onClose: () => void
  onRequestRender: () => void
}

// --- Controller ---

export class BranchPickerController {
  public list: FilterableListState<BranchSummary>
  public state: "closed" | "loading" | "open" | "create" = "closed"
  public loadingMessage: string | undefined

  private readonly branchCreateField = new SingleLineTextField()
  private readonly _callbacks: BranchPickerCallbacks

  constructor(callbacks: BranchPickerCallbacks) {
    this._callbacks = callbacks
    this.list = new FilterableListState<BranchSummary>([], (branch) => `${branch.name} ${branch.upstream ?? ""}`)
  }

  get branchCreateName(): string {
    return this.branchCreateField.value
  }

  set branchCreateName(value: string) {
    this.branchCreateField.setValue(value, "end")
  }

  public activeTextField(): SingleLineTextField | undefined {
    if (this.state === "create") {
      return this.branchCreateField
    }
    return this.state === "open" ? this.list.searchField : undefined
  }

  // --- Lifecycle ---

  public open(branches: BranchSummary[]): void {
    this.state = "open"
    this.list.items = branches
    this.list.reset()
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  public close(): void {
    this.state = "closed"
    this.loadingMessage = undefined
    this.branchCreateName = ""
    this._callbacks.onClose()
    this._callbacks.onRequestRender()
  }

  public isOpen(): boolean {
    return this.state !== "closed"
  }

  // --- Input handling ---

  public handleInput(data: string): void {
    if (isEscapeInput(data)) {
      if (this.state === "create") {
        this.state = "open"
        this._callbacks.onRequestRender()
      } else {
        this.close()
      }
      return
    }
    if (this.state === "loading") {
      return
    }
    if (this.state === "create") {
      this.updateCreateInput(data)
      this._callbacks.onRequestRender()
      return
    }
    this.updatePickerInput(data)
    this.list.clampSelection()
    this._callbacks.onRequestRender()
  }

  private updatePickerInput(data: string): void {
    if (this.openCreateMode(data)) {
      return
    }
    handleFilterableListInput(data, this.list, (branch) => this._callbacks.onSwitch(branch.name))
  }

  private openCreateMode(data: string): boolean {
    if (!matchesKey(data, "ctrl+n") && data !== "\x0e") {
      return false
    }
    this.branchCreateName = ""
    this.state = "create"
    return true
  }

  private updateCreateInput(data: string): void {
    if (isEnter(data)) {
      this.submitCreateInput()
      return
    }
    this.branchCreateField.handleInput(data, "editor")
  }

  private submitCreateInput(): void {
    const name = this.branchCreateName.trim()
    if (name) {
      this._callbacks.onCreate(name)
      return
    }
    this._callbacks.onValidationError("Branch name is empty")
  }

  // --- Rendering (pure) ---

  /**
   * Render the overlay lines. The caller merges them onto the base lines.
   * Matches the existing branch picker rendering behavior exactly.
   */
  public renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[] {
    const frame = createOverlayFrame(baseLineCount, width, theme)
    const hint = frame.compact
      ? "↑↓ move • Enter select • Ctrl+N new • Esc"
      : "type search • Ctrl+N new • enter switch/create • F1 help • esc cancel"
    return renderOverlayFrame(
      frame,
      ` ${theme.fg("accent", theme.bold("Branches"))}`,
      ` ${theme.fg("dim", hint)}`,
      this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.compact, theme),
    )
  }

  private renderBodyRows(maxItems: number, innerWidth: number, compact: boolean, theme: Theme): string[] {
    if (this.state === "loading") {
      return [rowContent(` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    if (this.state === "create") {
      const prefix = " New branch: "
      const field = this.branchCreateField.render(
        Math.max(1, innerWidth - prefix.length),
        this.branchCreateField.focused,
        theme.fg("muted", "branch-name"),
      )
      return [rowContent(`${prefix}${field}`)]
    }
    const spacing = compact ? [] : [rowEmpty()]
    return [
      rowContent(this.renderSearchLine(innerWidth, theme)),
      ...spacing,
      ...this.renderBranchItems(maxItems, theme),
    ]
  }

  private renderSearchLine(innerWidth: number, theme: Theme): string {
    const prefix = " Search: "
    const field = this.list.searchField.render(
      Math.max(1, innerWidth - prefix.length),
      this.list.searchField.focused,
      theme.fg("muted", "type to filter branches"),
    )
    return `${prefix}${field}`
  }

  private renderBranchItems(maxItems: number, theme: Theme): string[] {
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      return [` ${theme.fg("muted", "No matching branches")}`]
    }
    const items = this.list.visibleItems(maxItems)
    return items.map(({ item, index }) => this.renderBranchRow(item, index, theme))
  }

  private renderBranchRow(branch: BranchSummary, index: number, theme: Theme): string {
    const selected = index === this.list.selectedIndex
    const marker = selected ? "▶" : " "
    const current = branch.current ? theme.fg("success", " current") : ""
    const upstream = branch.upstream
      ? `${theme.fg("muted", ` ${branch.upstream}`)}${branch.track ? theme.fg("muted", ` ${branch.track}`) : ""}`
      : ""
    const line = `${marker} ${theme.fg("accent", branch.name)}${current}${upstream}`
    return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`
  }
}

function rowEmpty(): string {
  return ""
}

function rowContent(content: string): string {
  return content
}
