import { matchesKey } from "@earendil-works/pi-tui"
import { loadWorkingTreeDiff } from "./git.js"
import { type BranchSummary, createAndSwitchBranch, listBranches, switchBranch } from "./git-extras.js"
import type { HelpContext } from "./types.js"
import { DiffViewerActions } from "./viewer-actions.js"

export class DiffViewerBranchPicker extends DiffViewerActions {
  protected branchState: "closed" | "loading" | "open" | "create" = "closed"
  protected branches: BranchSummary[] = []
  protected branchSearchQuery = ""
  protected branchCreateName = ""
  protected selectedBranchIndex = 0
  protected branchScroll = 0

  protected override featureHelpContext(): HelpContext | undefined {
    if (this.branchState !== "closed") {
      return "branchPicker"
    }
    return super.featureHelpContext()
  }

  protected override hasFeatureOverlay(): boolean {
    return this.branchState !== "closed" || super.hasFeatureOverlay()
  }

  protected override renderFeatureOverlay(baseLines: string[], width: number): string[] {
    if (this.branchState !== "closed") {
      return this.renderBranchOverlay(baseLines, width)
    }
    return super.renderFeatureOverlay(baseLines, width)
  }

  protected override handleFeatureOverlayInput(data: string): boolean {
    if (this.branchState !== "closed") {
      this.handleBranchInput(data)
      return true
    }
    return super.handleFeatureOverlayInput(data)
  }

  protected override handleFeatureOpenInput(data: string): boolean {
    if (data === "b") {
      this.openBranchPicker().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return super.handleFeatureOpenInput(data)
  }

  protected async openBranchPicker(): Promise<void> {
    if (this.document.repositoryState === "missing") {
      this.error = "Initialize a git repository before switching branches"
      this.statusMessage = undefined
      this.requestRender()
      return
    }
    this.error = undefined
    this.branchState = "loading"
    this.loadingMessage = "Loading branches…"
    this.requestRender()
    try {
      this.branches = await listBranches(this.pi, this.ctx.cwd, this.ctx.signal)
      this.branchState = "open"
      this.clampBranchSelection()
    } catch (error) {
      this.branchState = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected handleBranchInput(data: string): void {
    if (this.branchState === "loading") {
      return
    }
    if (this.closeBranchOnCancel(data)) {
      return
    }
    if (this.branchState === "create") {
      this.updateBranchCreateInput(data)
    } else {
      this.updateBranchPickerInput(data)
      this.clampBranchSelection()
    }
    this.requestRender()
  }

  protected closeBranchOnCancel(data: string): boolean {
    if (!matchesKey(data, "escape") && !this.isKey(data, "q")) {
      return false
    }
    this.branchState = "closed"
    this.requestRender()
    return true
  }

  protected updateBranchPickerInput(data: string): void {
    const handlers = [
      () => this.handleOpenBranchCreate(data),
      () => this.handleBranchSearchBackspace(data),
      () => this.handleBranchSearchText(data),
      () => this.handleBranchSelectionMove(data),
      () => this.handleBranchSelection(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  protected handleOpenBranchCreate(data: string): boolean {
    if (!matchesKey(data, "ctrl+n") && data !== "\x0e") {
      return false
    }
    this.branchCreateName = ""
    this.branchState = "create"
    return true
  }

  protected handleBranchSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.branchSearchQuery = [...this.branchSearchQuery].slice(0, -1).join("")
    this.resetBranchScroll()
    return true
  }

  protected handleBranchSearchText(data: string): boolean {
    if (!this.isPrintableInput(data)) {
      return false
    }
    this.branchSearchQuery += data
    this.resetBranchScroll()
    return true
  }

  protected handleBranchSelectionMove(data: string): boolean {
    const nextIndex = this.nextListSelectionIndex(data, this.selectedBranchIndex, this.branchItemCount())
    if (nextIndex === undefined) {
      return false
    }
    this.selectedBranchIndex = nextIndex
    return true
  }

  protected handleBranchSelection(data: string): boolean {
    if (!this.isEnter(data)) {
      return false
    }
    const branch = this.branchItem(this.selectedBranchIndex)
    if (!branch) {
      return true
    }
    this.runBranchSwitch(branch.name).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  protected updateBranchCreateInput(data: string): void {
    if (this.isBackspace(data)) {
      this.branchCreateName = [...this.branchCreateName].slice(0, -1).join("")
      return
    }
    if (this.isEnter(data)) {
      const name = this.branchCreateName.trim()
      if (!name) {
        this.error = "Branch name is empty"
        return
      }
      this.runBranchCreate(name).catch((error: unknown) => this.showAsyncError(error))
      return
    }
    if (this.isPrintableInput(data)) {
      this.branchCreateName += data
    }
  }

  protected async runBranchSwitch(name: string): Promise<void> {
    this.branchState = "loading"
    this.loadingMessage = `Switching to ${name}…`
    this.requestRender()
    try {
      this.statusMessage = await switchBranch(this.pi, this.ctx.cwd, name, this.ctx.signal)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
      this.branchState = "closed"
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.branchState = "open"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected async runBranchCreate(name: string): Promise<void> {
    this.branchState = "loading"
    this.loadingMessage = `Creating ${name}…`
    this.requestRender()
    try {
      this.statusMessage = await createAndSwitchBranch(this.pi, this.ctx.cwd, name, this.ctx.signal)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
      this.branchState = "closed"
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.branchState = "create"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  protected resetBranchScroll(): void {
    this.selectedBranchIndex = 0
    this.branchScroll = 0
  }

  protected clampBranchSelection(): void {
    this.selectedBranchIndex = Math.max(0, Math.min(Math.max(0, this.branchItemCount() - 1), this.selectedBranchIndex))
  }

  protected branchItemCount(): number {
    return this.branchItems().length
  }

  protected branchItem(index: number): BranchSummary | undefined {
    return this.branchItems()[index]
  }

  protected branchItems(): BranchSummary[] {
    const tokens = this.searchTokens(this.branchSearchQuery)
    if (tokens.length === 0) {
      return this.branches
    }
    return this.branches.filter((branch) => this.matchesSearch(`${branch.name} ${branch.upstream ?? ""}`, tokens))
  }

  protected renderBranchOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    const overlay = [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Branches"))}`),
      row(` ${this.theme.fg("dim", "type search • Ctrl+N new • enter switch/create • ? help • esc cancel")}`),
      ...this.branchOverlayBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  protected branchOverlayBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.branchState === "loading") {
      return [row(""), row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    if (this.branchState === "create") {
      return [row(""), row(` New branch: ${this.branchCreateName || this.theme.fg("muted", "branch-name")}▌`)]
    }
    return [
      row(this.renderBranchSearchLine()),
      row(""),
      ...this.visibleBranchItems(maxItems).map(({ branch, index }) => row(this.renderBranchItem(branch, index))),
    ]
  }

  protected renderBranchSearchLine(): string {
    const query = this.branchSearchQuery
      ? `${this.branchSearchQuery}▌`
      : this.theme.fg("muted", "type to filter branches")
    return ` Search: ${query}`
  }

  protected visibleBranchItems(maxItems: number): Array<{ branch: BranchSummary; index: number }> {
    this.branchScroll = this.nextListScroll(
      this.selectedBranchIndex,
      this.branchScroll,
      this.branchItemCount(),
      maxItems,
    )
    return this.branchItems()
      .slice(this.branchScroll, this.branchScroll + maxItems)
      .map((branch, offset) => ({ branch, index: this.branchScroll + offset }))
  }

  protected renderBranchItem(branch: BranchSummary, index: number): string {
    const selected = index === this.selectedBranchIndex
    const marker = selected ? "▶" : " "
    const current = branch.current ? this.theme.fg("success", " current") : ""
    const upstream = branch.upstream
      ? this.theme.fg("muted", ` ${branch.upstream}${branch.track ? ` ${branch.track}` : ""}`)
      : ""
    const line = ` ${marker} ${this.theme.fg("accent", branch.name)}${current}${upstream}`
    return selected ? this.theme.bg("selectedBg", line) : line
  }
}
