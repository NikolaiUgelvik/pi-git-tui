import { wrapTextWithAnsi } from "@earendil-works/pi-tui"
import { renderDiffViewport } from "./diff-viewport.js"
import { fit } from "./render-text.js"
import { measureViewerGeometry, SPLIT_LAYOUT_MIN_WIDTH, type ViewerGeometry } from "./responsive-geometry.js"
import { renderScrollbar } from "./scrollbar.js"
import { buildTreeRows } from "./tree.js"
import { type DiffFile, type FocusPanel, TREE_STATUS_COLORS } from "./types.js"
import { DiffViewerCore } from "./viewer-core.js"
import { prioritizedFooter, viewerFooterActions } from "./viewer-footer-actions.js"

export class DiffViewerFrame extends DiffViewerCore {
  private diffMaximumColumn = 0
  render(width: number): string[] {
    const geometry = measureViewerGeometry({
      width,
      terminalRows: this.getTerminalRows(),
      focusedPanel: this.focusedPanel,
      empty: this.files.length === 0,
    })
    if (geometry.layout === "too-small") {
      return this.renderOverlays(this.renderTooSmallFrame(geometry), geometry.width)
    }
    const side = this.theme.fg("border", "│")
    const frame = (content: string) => fit(`${side}${fit(content, geometry.innerWidth)}${side}`, geometry.width)
    const lines = [this.frameBorder("top", geometry)]
    lines.push(frame(this.renderHeader(geometry.innerWidth)))
    if (geometry.density === "normal") {
      lines.push(frame(this.renderSubtitle(geometry.innerWidth)), this.frameBorder("middle", geometry))
    }
    lines.push(...this.renderMainPanel(geometry).map(frame))
    if (geometry.density === "normal") {
      lines.push(this.frameBorder("middle", geometry))
    }
    lines.push(frame(this.renderFooter(geometry.innerWidth)), this.frameBorder("bottom", geometry))
    return this.renderOverlays(lines.slice(0, geometry.height), geometry.width)
  }

  private frameBorder(edge: "top" | "middle" | "bottom", geometry: ViewerGeometry): string {
    const ends = edge === "top" ? ["╭", "╮"] : edge === "bottom" ? ["╰", "╯"] : ["├", "┤"]
    return fit(this.theme.fg("border", `${ends[0]}${"─".repeat(geometry.innerWidth)}${ends[1]}`), geometry.width)
  }

  private renderMainPanel(geometry: ViewerGeometry): string[] {
    if (geometry.layout === "empty") {
      return [this.renderSummaryTitle(geometry.mainWidth), ...this.renderDiff(geometry.mainWidth, geometry.bodyRows)]
    }
    if (geometry.layout === "single") {
      const panel = this.focusedPanel
      const panelWidth = panel === "tree" ? geometry.treeWidth : geometry.diffWidth
      const body =
        panel === "tree"
          ? this.renderTree(panelWidth, geometry.bodyRows)
          : this.renderDiff(panelWidth, geometry.bodyRows)
      return [this.renderPanelTitle(panel, panelWidth, true), ...body]
    }
    const treeBody = this.renderTree(geometry.treeWidth, geometry.bodyRows)
    const diffBody = this.renderDiff(geometry.diffWidth, geometry.bodyRows)
    const treeLines = [this.renderPanelTitle("tree", geometry.treeWidth), ...treeBody]
    const diffLines = [this.renderPanelTitle("diff", geometry.diffWidth), ...diffBody]
    const separator = this.theme.fg("border", "│")
    return Array.from(
      { length: geometry.panelRows },
      (_, index) =>
        `${treeLines[index] ?? " ".repeat(geometry.treeWidth)}${separator}${diffLines[index] ?? " ".repeat(geometry.diffWidth)}`,
    )
  }

  private renderSummaryTitle(width: number): string {
    return fit(this.theme.fg("accent", this.theme.bold("▶ Summary")), width)
  }

  private renderTooSmallFrame(geometry: ViewerGeometry): string[] {
    if (geometry.height <= 0) {
      return []
    }
    if (geometry.height === 1) {
      return [fit("Terminal too small", geometry.width)]
    }
    const lines = [this.frameBorder("top", geometry)]
    while (lines.length < geometry.height - 1) {
      const message = lines.length === 1 ? "Terminal too small; resize to continue" : ""
      lines.push(fit(`│${fit(message, geometry.innerWidth)}│`, geometry.width))
    }
    lines.push(this.frameBorder("bottom", geometry))
    return lines
  }

  protected renderHeader(width: number): string {
    if (this.document.mode === "working") {
      const view = this.workingTreeView === "working" ? "Working" : "Staged"
      const staged = this.formatDiffStats(this.document.staged.stats)
      const working = this.formatDiffStats(this.document.working.stats)
      const title = `${this.theme.bold(`${this.document.title} · ${view}`)} ${this.theme.fg("muted", `Staged ${staged} • Working ${working}`)}`
      return fit(title, width)
    }
    const stats = this.formatDiffStats(this.document.diff.stats)
    return fit(`${this.theme.bold(this.document.title)} ${this.theme.fg("muted", stats)}`, width)
  }

  protected formatDiffStats(stats: { files: number; additions: number; deletions: number }): string {
    const files = stats.files === 1 ? "1 file" : `${stats.files} files`
    return `${files} +${stats.additions} −${stats.deletions}`
  }

  protected formatCompactStats(stats: { files: number; additions: number; deletions: number }): string {
    return `${stats.files}/+${stats.additions}/−${stats.deletions}`
  }

  protected renderSubtitle(width: number): string {
    return fit(this.theme.fg("dim", this.document.subtitle || " "), width)
  }

  protected renderPanelTitle(panel: FocusPanel, width: number, single = false): string {
    const focused = this.focusedPanel === panel
    const scope = this.document.mode === "working" ? ` · ${this.workingTreeView}` : ""
    const destination = panel === "tree" ? "Diff" : "Files"
    const switchHint = single ? ` · Tab: ${destination}` : ""
    const columnHint = panel === "diff" && this.diffMaximumColumn > 0 ? this.diffColumnHint() : ""
    const label = `${panel === "tree" ? "Files" : "Diff"}${scope}${columnHint}${switchHint}`
    const marker = focused ? "▶ " : "  "
    const text = `${marker}${label}`
    return fit(focused ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text), width)
  }

  private diffColumnHint(): string {
    const left = this.diffColumn > 0 ? "‹" : ""
    const right = this.diffColumn < this.diffMaximumColumn ? "›" : ""
    return ` · ${left}col ${this.diffColumn + 1}${right}`
  }

  protected renderFooter(width: number): string {
    return this.renderOperationFooter(width) ?? this.renderDocumentFooter(width) ?? this.renderNavigationFooter(width)
  }

  private renderOperationFooter(width: number): string | undefined {
    const operation = this.operationSnapshot()
    switch (operation.state) {
      case "running":
        return this.theme.fg(
          "dim",
          prioritizedFooter(`… ${this.footerSummary(operation.summary, "Working…")}`, ["Esc cancel", "? help"], width),
        )
      case "cancelling":
        return this.theme.fg(
          "warning",
          prioritizedFooter(`… ${this.footerSummary(operation.summary, "Cancelling…")}`, ["? help"], width),
        )
      case "reconciling":
        return this.theme.fg(
          "warning",
          prioritizedFooter(`… ${this.footerSummary(operation.summary, "Reconciling…")}`, ["? help"], width),
        )
      case "refreshFailed":
        return this.renderRefreshFailureFooter(operation.summary, operation.successMessage, width)
      case "failed":
        return this.renderOperationFailureFooter(operation.summary, width)
      default:
        return
    }
  }

  private footerSummary(summary: string | undefined, fallback: string): string {
    return summary ?? fallback
  }

  private renderRefreshFailureFooter(
    summary: string | undefined,
    successMessage: string | undefined,
    width: number,
  ): string {
    const success = successMessage ? `✓ ${successMessage} • ` : ""
    return this.theme.fg(
      "warning",
      prioritizedFooter(
        `${success}⚠ ${summary ?? "Diff refresh failed"}`,
        ["r retry refresh", "? help", "q close"],
        width,
      ),
    )
  }

  private renderOperationFailureFooter(summary: string | undefined, width: number): string {
    const controls = this.documentState.failure ? ["r retry", "? help", "q close"] : ["? help", "q close"]
    return this.theme.fg("warning", prioritizedFooter(`⚠ ${summary ?? "Operation failed"}`, controls, width))
  }

  private renderDocumentFooter(width: number): string | undefined {
    const operation = this.operationSnapshot()
    if (this.documentState.failure) {
      return this.theme.fg(
        "warning",
        prioritizedFooter(`⚠ ${this.documentState.failure.summary}`, ["r retry", "? help", "q close"], width),
      )
    }
    if (this.documentState.failedTarget) {
      return this.theme.fg(
        "warning",
        prioritizedFooter(
          `⚠ ${this.documentState.failedTarget.summary}`,
          ["r retry target", "W working tree", "? help", "q close"],
          width,
        ),
      )
    }
    if (this.error) {
      return this.theme.fg("warning", prioritizedFooter(`⚠ ${this.error}`, ["? help", "q close"], width))
    }
    if (operation.state === "succeeded" && operation.successMessage) {
      return this.theme.fg(
        "success",
        prioritizedFooter(`✓ ${operation.successMessage}`, ["r reload", "? help", "q close"], width),
      )
    }
    if (this.statusMessage) {
      return this.theme.fg(
        "success",
        prioritizedFooter(`✓ ${this.statusMessage}`, ["r reload", "? help", "q close"], width),
      )
    }
    if (this.document.repositoryState === "missing") {
      return this.theme.fg("dim", prioritizedFooter("No git repo", ["I init", "r reload", "? help", "q close"], width))
    }
  }

  private renderNavigationFooter(width: number): string {
    if (width < SPLIT_LAYOUT_MIN_WIDTH) {
      const destination = this.focusedPanel === "tree" ? "diff" : "files"
      const contextualEscape = this.document.mode === "commit" ? "W tree" : `Tab ${destination}`
      const summary = this.focusedPanel === "diff" ? "←→ cols" : ""
      return this.theme.fg("dim", prioritizedFooter(summary, [contextualEscape, "? help", "q close"], width))
    }
    const parts = viewerFooterActions(
      {
        document: this.document,
        focusedPanel: this.focusedPanel,
        workingTreeView: this.workingTreeView,
        totals: this.navigationTotals(),
      },
      width,
    )
    return fit(this.theme.fg("dim", parts.join(" • ")), width)
  }

  private navigationTotals(): string {
    if (this.document.mode !== "working") {
      return ""
    }
    const staged = this.formatCompactStats(this.document.staged.stats)
    const working = this.formatCompactStats(this.document.working.stats)
    return `staged ${staged} • working ${working} • `
  }

  protected renderTree(width: number, height: number): string[] {
    if (this.files.length === 0) {
      const lines = [this.theme.fg("muted", `  No ${this.visibleSlice.scope} changes`)]
      while (lines.length < height) {
        lines.push("")
      }
      return renderScrollbar(lines, {
        width,
        viewportHeight: height,
        contentHeight: lines.length,
        scrollOffset: 0,
        theme: this.theme,
      })
    }

    const rows = buildTreeRows(this.files)
    const selectedRow = Math.max(
      0,
      rows.findIndex((row) => row.fileIndex === this.selectedFileIndex),
    )
    const start = Math.max(0, Math.min(selectedRow - Math.floor(height / 2), Math.max(0, rows.length - height)))
    const visibleRows = rows.slice(start, start + height)
    const isTreeFocused = this.focusedPanel === "tree"
    const lines = visibleRows.map((row) => {
      const isSelected = row.fileIndex === this.selectedFileIndex
      const indent = "  ".repeat(row.depth)
      const icon = row.fileIndex === undefined ? "▸ " : isSelected ? "▶ " : "  "
      const raw = `${indent}${icon}${row.label}`
      const file = row.fileIndex === undefined ? undefined : this.files[row.fileIndex]
      const colored = file ? this.colorTreeFile(raw, file, isSelected) : this.theme.fg("muted", raw)
      return isSelected && isTreeFocused ? this.theme.bg("selectedBg", colored) : colored
    })
    while (lines.length < height) {
      lines.push("")
    }
    return renderScrollbar(lines, {
      width,
      viewportHeight: height,
      contentHeight: rows.length,
      scrollOffset: start,
      theme: this.theme,
    })
  }

  protected colorTreeFile(line: string, file: DiffFile, selected: boolean): string {
    const emphasized = file.stageState === "staged" || file.stageState === "mixed"
    const color = selected || emphasized ? "accent" : TREE_STATUS_COLORS[file.status]
    return this.theme.fg(color, line)
  }

  protected renderDiff(width: number, height: number): string[] {
    const failure = this.currentFailureDetails()
    if (failure) {
      this.diffMaximumColumn = 0
      this.diffColumn = 0
      return this.renderFailurePanel(failure.summary, failure.details, width, height)
    }
    const file = this.files[this.selectedFileIndex]
    if (!file) {
      this.diffMaximumColumn = 0
      this.diffColumn = 0
      const message = this.emptyDiffMessage()
      const lines = [this.theme.fg("muted", message)]
      while (lines.length < height) {
        lines.push("")
      }
      return lines.map((line) => fit(line, width))
    }

    const viewport = renderDiffViewport({
      file,
      width,
      height,
      verticalOffset: this.diffScroll,
      horizontalOffset: this.diffColumn,
      theme: this.theme,
    })
    this.diffScroll = viewport.verticalOffset
    this.diffColumn = viewport.horizontalOffset
    this.diffMaximumColumn = viewport.maxHorizontalOffset
    return viewport.lines
  }

  protected renderFailurePanel(summary: string, details: string, width: number, height: number): string[] {
    const contentWidth = Math.max(1, width - 1)
    const detailRows = details.split("\n").flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth))
    const retryHint = this.operationSnapshot().canRetryRefresh
      ? "Press r to retry the refresh only. The mutation will not run again."
      : "Press r to reload this document."
    const spacing = height >= 4 ? [""] : []
    const rows = [
      this.theme.fg("warning", `⚠ ${summary}`),
      ...spacing,
      ...detailRows,
      ...spacing,
      this.theme.fg("accent", retryHint),
    ]
    const maxScroll = Math.max(0, rows.length - height)
    this.diffScroll = Math.max(0, Math.min(this.diffScroll, maxScroll))
    const visible = rows.slice(this.diffScroll, this.diffScroll + height)
    while (visible.length < height) {
      visible.push("")
    }
    return renderScrollbar(visible, {
      width,
      viewportHeight: height,
      contentHeight: rows.length,
      scrollOffset: this.diffScroll,
      theme: this.theme,
    })
  }

  protected emptyDiffMessage(): string {
    if (this.document.repositoryState === "missing") {
      return "No git repository found here. Press I to initialize one."
    }
    if (this.document.mode === "commit") {
      return "This commit has no textual diff."
    }
    if (this.document.staged.stats.files === 0 && this.document.working.stats.files === 0) {
      return "Working tree is clean. Press c to inspect commit history."
    }
    return this.workingTreeView === "staged"
      ? "Nothing staged. Press v to review working changes."
      : "No unstaged changes. Press v to review staged changes."
  }
}
