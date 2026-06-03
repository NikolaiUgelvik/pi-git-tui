import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff } from "./git.js"
import { applyStash, dropStash, listStashes, popStash, type StashSummary, stashCurrentChanges } from "./git-extras.js"
import type { HelpContext } from "./types.js"
import { DiffViewerBranchPicker } from "./viewer-branch-picker.js"

export type StashAction = "stash-current" | "stash-item"
export type StashConfirm = "pop" | "drop"
export type StashItem = { type: StashAction; stash?: StashSummary }

export class DiffViewerStashPicker extends DiffViewerBranchPicker {
  protected stashState: "closed" | "loading" | "open" | "confirm" = "closed"
  protected stashes: StashSummary[] = []
  protected stashSearchQuery = ""
  protected selectedStashIndex = 0
  protected stashScroll = 0
  protected stashConfirmAction: StashConfirm | undefined
  protected stashConfirmRef = ""

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.stashState !== "closed") {
      return "stashPicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.stashState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.stashState !== "closed") {
      return this.renderStashOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.stashState !== "closed") {
      this.handleStashInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "s") {
      this.openStashPicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openStashPicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before using stashes"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.stashState = "loading"
    this.loadingMessage = "Loading stashes…"
    this.requestRender()
    try {
      this.stashes = await listStashes(this.pi, this.ctx.cwd, this.ctx.signal)
      this.stashState = "open"
      this.clampStashSelection()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.stashState = "closed"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleStashInput(data: string): void {
    if (this.stashState === "loading") {
      return
    }
    if (this.stashState === "confirm") {
      this.handleStashConfirmInput(data)
      return
    }
    if (this.closeStashOnCancel(data)) {
      return
    }
    this.updateStashPickerInput(data)
    this.clampStashSelection()
    this.requestRender()
  }

  protected closeStashOnCancel(data: string): boolean {
    if (!matchesKey(data, "escape") && !this.isKey(data, "q")) {
      return false
    }
    this.stashState = "closed"
    this.requestRender()
    return true
  }

  protected updateStashPickerInput(data: string): void {
    const handlers = [
      () => this.handleStashSearchBackspace(data),
      () => this.handleStashSelectionMove(data),
      () => this.handleStashPop(data),
      () => this.handleStashDrop(data),
      () => this.handleStashSelection(data),
      () => this.handleStashSearchText(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleStashSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.stashSearchQuery = [...this.stashSearchQuery].slice(0, -1).join("")
    this.resetStashScroll()
    return true
  }

  protected handleStashSearchText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    this.stashSearchQuery += data
    this.resetStashScroll()
    return true
  }

  protected handleStashSelectionMove(data: string): boolean {
    const nextIndex = this.nextListSelectionIndex(data, this.selectedStashIndex, this.stashItemCount())
    if (nextIndex === undefined) {
      return false
    }
    this.selectedStashIndex = nextIndex
    return true
  }

  protected handleStashSelection(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const item = this.stashItem(this.selectedStashIndex)
    if (!item) {
      return true
    }
    if (item.type === "stash-current") {
      this.runStashCurrent().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    if (item.stash) {
      this.runStashApply(item.stash.ref).catch((error: unknown) => this.showAsyncError(error))
    }
    return true
  }

  protected handleStashPop(data: string): boolean {
    if (!matchesKey(data, "ctrl+p") && data !== "\x10") {
      return false
    }
    return this.openStashConfirm("pop")
  }

  protected handleStashDrop(data: string): boolean {
    if (!matchesKey(data, "ctrl+d") && data !== "\x04") {
      return false
    }
    return this.openStashConfirm("drop")
  }

  protected openStashConfirm(action: StashConfirm): boolean {
    const item = this.stashItem(this.selectedStashIndex)
    if (item?.type !== "stash-item" || !item.stash) {
      return true
    }
    this.stashConfirmAction = action
    this.stashConfirmRef = item.stash.ref
    this.stashState = "confirm"
    return true
  }

  protected handleStashConfirmInput(data: string): void {
    if (matchesKey(data, "escape") || this.isKey(data, "q")) {
      this.stashState = "open"
      this.requestRender()
      return
    }
    if (this.isEnter(data)) {
      this.runStashConfirmedAction().catch((error: unknown) => this.showAsyncError(error))
    }
  }

  protected async runStashCurrent(): Promise<void> {
    const succeeded = await this.runStashOperation("Stashing current changes…", () =>
      stashCurrentChanges(this.pi, this.ctx.cwd, this.ctx.signal),
    )
    if (succeeded) {
      this.stashes = await listStashes(this.pi, this.ctx.cwd, this.ctx.signal)
      this.stashState = "open"
    }
  }

  protected async runStashApply(ref: string): Promise<void> {
    if (
      await this.runStashOperation(`Applying ${ref}…`, () => applyStash(this.pi, this.ctx.cwd, ref, this.ctx.signal))
    ) {
      this.stashState = "closed"
    }
  }

  protected async runStashConfirmedAction(): Promise<void> {
    const ref = this.stashConfirmRef
    const action = this.stashConfirmAction
    const succeeded = await this.runStashOperation(`${action === "pop" ? "Popping" : "Dropping"} ${ref}…`, () => {
      if (action === "pop") {
        return popStash(this.pi, this.ctx.cwd, ref, this.ctx.signal)
      }
      return dropStash(this.pi, this.ctx.cwd, ref, this.ctx.signal)
    })
    if (succeeded) {
      this.stashState = action === "drop" ? "open" : "closed"
      this.stashes = await listStashes(this.pi, this.ctx.cwd, this.ctx.signal)
    }
  }

  protected async runStashOperation(label: string, operation: () => Promise<string>): Promise<boolean> {
    this.stashState = "loading"
    this.loadingMessage = label
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      this.statusMessage = await operation()
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      return true
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      await this.refreshWorkingTreeAfterStashFailure()
      this.stashState = "open"
      return false
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async refreshWorkingTreeAfterStashFailure(): Promise<void> {
    if (this.document.mode !== "working") {
      return
    }
    try {
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      this.error = `${this.error}; refresh failed: ${message}`
    }
  }

  protected resetStashScroll(): void {
    this.selectedStashIndex = 0
    this.stashScroll = 0
  }

  protected clampStashSelection(): void {
    this.selectedStashIndex = Math.max(0, Math.min(Math.max(0, this.stashItemCount() - 1), this.selectedStashIndex))
  }

  protected stashItemCount(): number {
    return this.stashItems().length
  }

  protected stashItem(index: number): StashItem | undefined {
    return this.stashItems()[index]
  }

  protected stashItems(): StashItem[] {
    const stashItems = this.filteredStashes().map((stash): StashItem => ({ type: "stash-item", stash }))
    return [{ type: "stash-current" }, ...stashItems]
  }

  protected filteredStashes(): StashSummary[] {
    const tokens = this.searchTokens(this.stashSearchQuery)
    if (tokens.length === 0) {
      return this.stashes
    }
    return this.stashes.filter((stash) => this.matchesSearch(`${stash.ref} ${stash.message}`, tokens))
  }

  protected renderStashOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    const overlay = [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold(this.stashTitle()))}`),
      row(` ${this.theme.fg("dim", "enter stash/apply • Ctrl+P pop • Ctrl+D drop • ? help • esc cancel")}`),
      ...this.stashBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected stashTitle(): string {
    if (this.stashState === "confirm") {
      return this.stashConfirmAction === "pop" ? "Pop stash?" : "Drop stash?"
    }
    return "Stashes"
  }

  protected stashBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.stashState === "loading") {
      return [row(""), row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    if (this.stashState === "confirm") {
      return [
        row(""),
        row(` ${this.stashTitle()} ${this.stashConfirmRef}`),
        row(this.theme.fg("warning", " Enter OK • Esc/q Cancel")),
      ]
    }
    return [
      row(this.renderStashSearchLine()),
      row(""),
      ...this.visibleStashItems(maxItems).map(({ item, index }) => row(this.renderStashItem(item, index))),
    ]
  }

  protected renderStashSearchLine(): string {
    const query = this.stashSearchQuery ? `${this.stashSearchQuery}▌` : this.theme.fg("muted", "type to filter stashes")
    return ` Search: ${query}`
  }

  protected visibleStashItems(maxItems: number): Array<{ item: StashItem; index: number }> {
    this.stashScroll = this.nextListScroll(this.selectedStashIndex, this.stashScroll, this.stashItemCount(), maxItems)
    return this.stashItems()
      .slice(this.stashScroll, this.stashScroll + maxItems)
      .map((item, offset) => ({ item, index: this.stashScroll + offset }))
  }

  protected renderStashItem(item: StashItem, index: number): string {
    const selected = index === this.selectedStashIndex
    const marker = selected ? "▶" : " "
    const line =
      item.type === "stash-current" ? this.renderStashCurrentItem(marker) : this.renderExistingStashItem(item, marker)
    return selected ? this.theme.bg("selectedBg", line) : line
  }

  protected renderStashCurrentItem(marker: string): string {
    return ` ${marker} ${this.theme.fg("accent", "stash current changes")} ${this.theme.fg("muted", "includes untracked")}`
  }

  protected renderExistingStashItem(item: StashItem, marker: string): string {
    const stash = item.stash
    return ` ${marker} ${this.theme.fg("accent", stash?.ref ?? "stash")} ${stash?.message ?? ""}`
  }
}
