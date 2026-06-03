import { DIFF_LINE_STYLE_RULES } from "./diff-line-style.js"
import { fit } from "./render-text.js"
import { buildTreeRows } from "./tree.js"
import { type DiffFile, type FocusPanel, TREE_STATUS_COLORS } from "./types.js"
import { DiffViewerCore } from "./viewer-core.js"

export class DiffViewerFrame extends DiffViewerCore {
  render(width: number): string[] {
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
    const focusLabel = this.focusedPanel === "tree" ? "files" : "diff"
    const arrows = this.focusedPanel === "tree" ? "↑↓/j/k files" : "↑↓/j/k code"
    const enterAction = this.focusedPanel === "tree" ? " • Enter stage/unstage • Shift+Enter stage/unstage all" : ""
    return fit(
      this.theme.fg(
        "dim",
        `focus:${focusLabel} • tab switch • n/p files • ${arrows}${enterAction} • PgUp/PgDn scroll • Home/End jump • c commits • C commit • ^P commands • ? help • q close`,
      ),
      width,
    )
  }

  protected renderTree(width: number, height: number): string[] {
    if (this.document.files.length === 0) {
      return [fit(this.theme.fg("muted", "  No changes"), width), ...new Array(height - 1).fill(" ".repeat(width))]
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
      return fit(isSelected && isTreeFocused ? this.theme.bg("selectedBg", colored) : colored, width)
    })
    while (lines.length < height) {
      lines.push(" ".repeat(width))
    }
    return lines
  }

  protected colorTreeFile(line: string, file: DiffFile, selected: boolean): string {
    const color = selected || file.staged ? "accent" : TREE_STATUS_COLORS[file.status]
    return this.theme.fg(color, line)
  }

  protected renderDiff(width: number, height: number): string[] {
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      const message =
        this.document.mode === "working"
          ? "Working tree is clean. Press c to inspect commit history."
          : "This commit has no textual diff."
      return [fit(this.theme.fg("muted", message), width), ...new Array(height - 1).fill(" ".repeat(width))]
    }

    const diffLines = file.lines
    const maxScroll = Math.max(0, diffLines.length - height)
    this.diffScroll = Math.max(0, Math.min(this.diffScroll, maxScroll))
    const visible = diffLines
      .slice(this.diffScroll, this.diffScroll + height)
      .map((line) => fit(this.colorDiffLine(line), width))
    while (visible.length < height) {
      visible.push(" ".repeat(width))
    }
    return visible
  }

  protected colorDiffLine(line: string): string {
    const rule = DIFF_LINE_STYLE_RULES.find(({ matches }) => matches(line))
    if (!rule) {
      return this.theme.fg("toolDiffContext", line)
    }
    return this.theme.fg(rule.color, rule.bold ? this.theme.bold(line) : line)
  }
}
