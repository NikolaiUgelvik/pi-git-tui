import { type DiffDisplayRow, formatDiffDisplay } from "./diff-display.js"
import { diffLineStyleForText } from "./diff-line-style.js"
import { fit } from "./render-text.js"
import { renderScrollbar } from "./scrollbar.js"
import { buildTreeRows } from "./tree.js"
import { type DiffFile, type FocusPanel, type ThemeColor, TREE_STATUS_COLORS } from "./types.js"
import { DiffViewerCore } from "./viewer-core.js"

function diffDisplayRowColor(row: DiffDisplayRow): ThemeColor {
  switch (row.type) {
    case "addition":
      return "toolDiffAdded"
    case "deletion":
      return "toolDiffRemoved"
    case "hunk":
      return "accent"
    case "summary":
    case "unknown":
      return "muted"
    default:
      return "toolDiffContext"
  }
}

export class DiffViewerFrame extends DiffViewerCore {
  render(width: number): string[] {
    // Pre-render: clamp scroll positions before rendering
    this.clampDiffScroll()

    const innerWidth = Math.max(10, width - 2)
    const separatorWidth = 1
    const panelWidth = Math.max(2, innerWidth - separatorWidth)
    const minLeft = Math.min(24, Math.max(1, Math.floor(panelWidth / 3)))
    const maxLeft = Math.max(1, panelWidth - 1)
    const leftWidth = Math.max(1, Math.min(maxLeft, Math.max(minLeft, Math.min(42, Math.floor(innerWidth * 0.34)))))
    const rightWidth = Math.max(1, panelWidth - leftWidth)
    const lines: string[] = []
    const side = this.theme.fg("border", "│")
    const frame = (content: string) => fit(`${side}${fit(content, innerWidth)}${side}`, width)

    const viewHeight = this.viewHeight()
    const bodyHeight = viewHeight - 1
    lines.push(fit(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`), width))
    lines.push(frame(this.renderHeader(innerWidth)))
    lines.push(frame(this.renderSubtitle(innerWidth)))
    lines.push(fit(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`), width))

    const treeLines = [this.renderPanelTitle("tree", leftWidth), ...this.renderTree(leftWidth, bodyHeight)]
    const diffLines = [this.renderPanelTitle("diff", rightWidth), ...this.renderDiff(rightWidth, bodyHeight)]
    const sep = this.theme.fg("border", "│")
    for (let i = 0; i < viewHeight; i++) {
      lines.push(frame(`${treeLines[i] ?? " ".repeat(leftWidth)}${sep}${diffLines[i] ?? " ".repeat(rightWidth)}`))
    }

    lines.push(fit(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`), width))
    lines.push(frame(this.renderFooter(innerWidth)))
    lines.push(fit(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`), width))

    return this.renderOverlays(lines, width)
  }

  protected renderHeader(width: number): string {
    const fileCount = this.document.files.length
    const count = fileCount === 1 ? "1 file" : `${fileCount} files`
    const title = `${this.theme.bold(this.document.title)} ${this.theme.fg("muted", `(${count})`)}`
    return fit(title, width)
  }

  protected renderSubtitle(width: number): string {
    return fit(this.theme.fg("dim", this.document.subtitle || " "), width)
  }

  protected renderPanelTitle(panel: FocusPanel, width: number): string {
    const focused = this.focusedPanel === panel
    const label = panel === "tree" ? "Files" : "Diff"
    const marker = focused ? "▶ " : "  "
    const text = `${marker}${label}`
    return fit(focused ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text), width)
  }

  protected renderFooter(width: number): string {
    if (this.error) {
      return fit(this.theme.fg("warning", `⚠ ${this.error} • ? help • q close`), width)
    }
    if (this.statusMessage) {
      return fit(this.theme.fg("success", `✓ ${this.statusMessage} • ? help • q close`), width)
    }
    if (this.document.repositoryState === "missing") {
      return fit(this.theme.fg("dim", "No git repo • I init • ? help • q close"), width)
    }
    const focusLabel = this.focusedPanel === "tree" ? "files" : "diff"
    const arrows = this.focusedPanel === "tree" ? "↑↓/j/k files" : "↑↓/j/k code"
    const enterAction =
      this.focusedPanel === "tree" ? " • Enter stage/unstage • Shift+Enter stage/unstage all • D discard" : ""
    return fit(
      this.theme.fg(
        "dim",
        `focus:${focusLabel} • tab switch • n/p files • ${arrows}${enterAction} • PgUp/PgDn scroll • Home/End jump • c commits • C commit • b branches • w worktrees • s stash • ^P commands • ? help • q close`,
      ),
      width,
    )
  }

  protected renderTree(width: number, height: number): string[] {
    if (this.document.files.length === 0) {
      const lines = [this.theme.fg("muted", "  No changes")]
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

    const rows = buildTreeRows(this.document.files)
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
      const icon = row.fileIndex === undefined ? "▸ " : "  "
      const raw = `${indent}${icon}${row.label}`
      const file = row.fileIndex === undefined ? undefined : this.document.files[row.fileIndex]
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
    const color = selected || file.staged ? "accent" : TREE_STATUS_COLORS[file.status]
    return this.theme.fg(color, line)
  }

  /**
   * Clamp diffScroll to valid range. Call this before renderDiff() to ensure
   * the scroll position is valid for the current document state.
   */
  protected clampDiffScroll(): void {
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      this.diffScroll = 0
      return
    }
    const diffRows = formatDiffDisplay(file)
    const maxScroll = Math.max(0, diffRows.length - (this.viewHeight() - 1))
    this.diffScroll = Math.max(0, Math.min(this.diffScroll, maxScroll))
  }

  protected renderDiff(width: number, height: number): string[] {
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      const message = this.emptyDiffMessage()
      const lines = [this.theme.fg("muted", message)]
      while (lines.length < height) {
        lines.push("")
      }
      return renderScrollbar(lines, {
        width,
        viewportHeight: height,
        contentHeight: lines.length,
        scrollOffset: 0,
        minWidth: 100,
        theme: this.theme,
      })
    }

    const diffRows = formatDiffDisplay(file)
    const maxScroll = Math.max(0, diffRows.length - height)
    this.diffScroll = Math.max(0, Math.min(this.diffScroll, maxScroll))
    const gutterWidth = this.diffGutterWidth(diffRows)
    const visible = diffRows
      .slice(this.diffScroll, this.diffScroll + height)
      .map((row) => this.renderDiffDisplayRow(row, file, gutterWidth))
    while (visible.length < height) {
      visible.push("")
    }
    return renderScrollbar(visible, {
      width,
      viewportHeight: height,
      contentHeight: diffRows.length,
      scrollOffset: this.diffScroll,
      minWidth: 100,
      theme: this.theme,
    })
  }

  protected diffGutterWidth(rows: DiffDisplayRow[]): number {
    return rows.reduce((width, row) => {
      if (!this.isNumberedDiffRow(row)) {
        return width
      }
      return Math.max(width, String(row.lineNumber).length)
    }, 0)
  }

  protected renderDiffDisplayRow(row: DiffDisplayRow, file: DiffFile, gutterWidth: number): string {
    const line = this.diffDisplayRowText(row, file, gutterWidth)
    return this.colorDiffDisplayRow(row, line)
  }

  protected diffDisplayRowText(row: DiffDisplayRow, file: DiffFile, gutterWidth: number): string {
    if (row.type === "hunk") {
      const section = row.sectionText ? ` ${row.sectionText}` : ""
      return `@@ ${file.path} · ${this.hunkRange(row)} @@${section}`
    }
    if (this.isNumberedDiffRow(row)) {
      return `${row.marker}${String(row.lineNumber).padStart(gutterWidth)} │ ${row.text}`
    }
    return row.text
  }

  protected hunkRange(row: Extract<DiffDisplayRow, { type: "hunk" }>): string {
    if (row.newCount > 0) {
      return `lines ${this.lineRange(row.newStart, row.newCount)}`
    }
    return `old lines ${this.lineRange(row.oldStart, row.oldCount)}`
  }

  protected lineRange(start: number, count: number): string {
    return count === 1 ? String(start) : `${start}-${start + count - 1}`
  }

  protected isNumberedDiffRow(
    row: DiffDisplayRow,
  ): row is Extract<DiffDisplayRow, { type: "context" | "addition" | "deletion" }> {
    return row.type === "context" || row.type === "addition" || row.type === "deletion"
  }

  protected colorDiffDisplayRow(row: DiffDisplayRow, line: string): string {
    const probe = this.isNumberedDiffRow(row) ? `${row.marker}${row.text}` : line
    const conflictRule = diffLineStyleForText(probe)
    if (conflictRule?.bold) {
      return this.theme.fg(conflictRule.color, this.theme.bold(line))
    }
    return this.theme.fg(diffDisplayRowColor(row), line)
  }

  protected emptyDiffMessage(): string {
    if (this.document.repositoryState === "missing") {
      return "No git repository found here. Press I to initialize one."
    }
    return this.document.mode === "working"
      ? "Working tree is clean. Press c to inspect commit history."
      : "This commit has no textual diff."
  }

  protected colorDiffLine(line: string): string {
    const rule = diffLineStyleForText(line)
    if (!rule) {
      return this.theme.fg("toolDiffContext", line)
    }
    return this.theme.fg(rule.color, rule.bold ? this.theme.bold(line) : line)
  }
}
