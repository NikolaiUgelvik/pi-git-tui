import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const MAX_VIEW_HEIGHT = 34
const COMMIT_LIMIT = 200
const GIT_TIMEOUT_MS = 10_000
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024

type DiffMode = "working" | "commit"

interface CommitSummary {
  hash: string
  message: string
}

type CommitPickerItem = { type: "working" } | { type: "commit"; commit: CommitSummary }

interface DiffFile {
  path: string
  oldPath?: string
  newPath?: string
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary"
  lines: string[]
}

interface DiffDocument {
  mode: DiffMode
  title: string
  subtitle: string
  raw: string
  files: DiffFile[]
  commit?: CommitSummary
}

interface GitExecResult {
  stdout: string
  stderr: string
  code: number
  killed: boolean
}

type FocusPanel = "tree" | "diff"
type ThemeColor = Parameters<Theme["fg"]>[0]

const TREE_STATUS_COLORS: Record<DiffFile["status"], ThemeColor> = {
  added: "success",
  deleted: "error",
  renamed: "warning",
  copied: "warning",
  binary: "muted",
  modified: "text",
}

interface DiffLineStyleRule {
  matches: (line: string) => boolean
  color: ThemeColor
  bold?: boolean
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++")
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---")
}

function isDiffTitleLine(line: string): boolean {
  return line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---")
}

function isDiffMetadataLine(line: string): boolean {
  return ["index ", "new file", "deleted file", "similarity ", "rename "].some((prefix) => line.startsWith(prefix))
}

const DIFF_LINE_STYLE_RULES: DiffLineStyleRule[] = [
  { matches: isAddedDiffLine, color: "toolDiffAdded" },
  { matches: isRemovedDiffLine, color: "toolDiffRemoved" },
  { matches: (line) => line.startsWith("@@"), color: "accent" },
  { matches: isDiffTitleLine, color: "toolTitle", bold: true },
  { matches: isDiffMetadataLine, color: "muted" },
]

function isEnter(data: string): boolean {
  return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n"
}

function isPageUp(data: string): boolean {
  return matchesKey(data, "pageUp") || data === "\x1b[5~"
}

function isPageDown(data: string): boolean {
  return matchesKey(data, "pageDown") || data === "\x1b[6~"
}

function isPrintableInput(data: string): boolean {
  if (data.length === 0 || data.includes("\x1b")) {
    return false
  }
  return [...data].every((char) => {
    const codePoint = char.codePointAt(0)
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
  })
}

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g")

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, "")
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text))
  return text + " ".repeat(padding)
}

function fit(text: string, width: number): string {
  if (width <= 0) {
    return ""
  }
  // Raw git diffs can contain tabs. Terminals expand tabs to multiple cells,
  // while string-width helpers can undercount them, so normalize before sizing.
  const normalized = text.replace(/\t/g, "    ")
  return padToWidth(truncateToWidth(normalized, width, "…"), width)
}

function unquoteGitPath(path: string): string {
  let value = path.trim()
  if (value.startsWith("a/") || value.startsWith("b/")) {
    value = value.slice(2)
  }
  if (value === "/dev/null") {
    return value
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

const DIFF_GIT_LINE = /^diff --git (.+) (.+)$/

function pathFromDiffGit(line: string): string | undefined {
  const match = line.match(DIFF_GIT_LINE)
  if (!match) {
    return
  }
  return unquoteGitPath(match[2] ?? match[1] ?? "")
}

function statusFromLines(lines: string[], oldPath?: string, newPath?: string): DiffFile["status"] {
  if (lines.some((line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))) {
    return "binary"
  }
  if (lines.some((line) => line.startsWith("rename from "))) {
    return "renamed"
  }
  if (lines.some((line) => line.startsWith("copy from "))) {
    return "copied"
  }
  if (oldPath === "/dev/null") {
    return "added"
  }
  if (newPath === "/dev/null") {
    return "deleted"
  }
  return "modified"
}

function statusGlyph(status: DiffFile["status"]): string {
  switch (status) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "copied":
      return "C"
    case "binary":
      return "B"
    case "modified":
      return "M"
  }
}

interface DiffMetadata {
  oldPath?: string
  newPath?: string
  fallbackPath?: string
}

function normalizedDiffLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rawLines = normalized.length > 0 ? normalized.split("\n") : []
  if (rawLines.at(-1) === "") {
    rawLines.pop()
  }
  return rawLines
}

function diffChunks(lines: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      chunks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

function updateDiffMetadata(metadata: DiffMetadata, line: string): void {
  if (line.startsWith("diff --git ")) {
    metadata.fallbackPath = pathFromDiffGit(line) ?? metadata.fallbackPath
    return
  }
  if (line.startsWith("--- ")) {
    metadata.oldPath = unquoteGitPath(line.slice(4))
    return
  }
  if (line.startsWith("+++ ")) {
    metadata.newPath = unquoteGitPath(line.slice(4))
    return
  }
  if (line.startsWith("rename to ")) {
    metadata.newPath = unquoteGitPath(line.slice("rename to ".length))
    return
  }
  if (line.startsWith("rename from ")) {
    metadata.oldPath = unquoteGitPath(line.slice("rename from ".length))
  }
}

function extractDiffMetadata(lines: string[]): DiffMetadata {
  const metadata: DiffMetadata = {}
  for (const line of lines) {
    updateDiffMetadata(metadata, line)
  }
  return metadata
}

function displayPath(metadata: DiffMetadata): string {
  if (metadata.newPath && metadata.newPath !== "/dev/null") {
    return metadata.newPath
  }
  if (metadata.oldPath && metadata.oldPath !== "/dev/null") {
    return metadata.oldPath
  }
  return metadata.fallbackPath ?? "(unknown)"
}

function diffFileFromChunk(lines: string[]): DiffFile {
  const metadata = extractDiffMetadata(lines)
  return {
    path: displayPath(metadata),
    oldPath: metadata.oldPath,
    newPath: metadata.newPath,
    status: statusFromLines(lines, metadata.oldPath, metadata.newPath),
    lines,
  }
}

function parseDiff(raw: string): DiffFile[] {
  return diffChunks(normalizedDiffLines(raw)).map(diffFileFromChunk)
}

function emptyDocument(title: string, subtitle: string, mode: DiffMode, commit?: CommitSummary): DiffDocument {
  return { mode, title, subtitle, raw: "", files: [], commit }
}

function buildDocument(
  mode: DiffMode,
  title: string,
  subtitle: string,
  raw: string,
  commit?: CommitSummary,
): DiffDocument {
  const files = parseDiff(raw)
  return { mode, title, subtitle, raw, files, commit }
}

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
  return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS })
}

async function ensureGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const result = await git(pi, cwd, ["rev-parse", "--show-toplevel"], signal)
  if (result.code !== 0) {
    return
  }
  return result.stdout.trim()
}

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  const result = await git(pi, cwd, ["rev-parse", "--verify", "HEAD"], signal)
  return result.code === 0
}

async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await git(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return []
  }
  return result.stdout.split("\0").filter(Boolean)
}

async function readUntrackedDiff(pi: ExtensionAPI, cwd: string, file: string, signal?: AbortSignal): Promise<string> {
  const trackedResult = await git(pi, cwd, ["-c", "core.quotepath=false", "ls-files", "--stage", "--", file], signal)
  if (trackedResult.code === 0 && trackedResult.stdout.trim()) {
    return ""
  }

  const sizeResult = await git(pi, cwd, ["-c", "core.quotepath=false", "cat-file", "-e", `HEAD:${file}`], signal)
  if (sizeResult.code === 0) {
    return ""
  }

  const nodeStat = await stat(resolve(cwd, file)).catch(() => undefined)
  if (!nodeStat?.isFile() || nodeStat.size > MAX_UNTRACKED_FILE_BYTES) {
    return ""
  }

  const result = await git(
    pi,
    cwd,
    ["-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", file],
    signal,
  )
  return result.stdout
}

const BASE_DIFF_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-ext-diff",
  "--find-renames",
  "--find-copies",
  "--color=never",
]

function workingTreeDiffArgs(headExists: boolean): string[] {
  if (headExists) {
    return [...BASE_DIFF_ARGS, "HEAD", "--"]
  }
  return ["-c", "core.quotepath=false", "diff", "--cached", ...BASE_DIFF_ARGS.slice(3), "--"]
}

async function readUntrackedDiffs(
  pi: ExtensionAPI,
  root: string,
  files: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const diffs = await Promise.all(files.map((file) => readUntrackedDiff(pi, root, file, signal)))
  return diffs.filter((diff) => diff.trim().length > 0)
}

function joinDiffParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n")
}

async function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<DiffDocument> {
  const root = await ensureGitRepository(pi, ctx.cwd, ctx.signal)
  if (!root) {
    return emptyDocument("Not a git repository", ctx.cwd, "working")
  }

  const headExists = await hasHead(pi, root, ctx.signal)
  const diffResult = await git(pi, root, workingTreeDiffArgs(headExists), ctx.signal)
  const untracked = await listUntrackedFiles(pi, root, ctx.signal)
  const untrackedDiffs = await readUntrackedDiffs(pi, root, untracked, ctx.signal)
  const title = headExists ? "Working tree vs HEAD" : "Working tree (no commits yet)"
  return buildDocument("working", title, root, joinDiffParts([diffResult.stdout, ...untrackedDiffs]))
}

async function loadCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    return []
  }
  const result = await git(pi, root, ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"], signal)
  if (result.code !== 0 || !result.stdout.trim()) {
    return []
  }
  return result.stdout.split("\n").map((line) => {
    const [hash = "", ...messageParts] = line.split("\t")
    return { hash, message: messageParts.join("\t") }
  })
}

async function loadCommitDiff(
  pi: ExtensionAPI,
  cwd: string,
  commit: CommitSummary,
  signal?: AbortSignal,
): Promise<DiffDocument> {
  const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd
  const result = await git(
    pi,
    root,
    [
      "-c",
      "core.quotepath=false",
      "show",
      "--format=",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--color=never",
      commit.hash,
      "--",
    ],
    signal,
  )
  return buildDocument("commit", `Commit ${commit.hash}`, commit.message, result.stdout, commit)
}

interface TreeRow {
  label: string
  fileIndex?: number
  depth: number
  isLast: boolean
}

interface IndexedDiffFile {
  file: DiffFile
  index: number
}

function addDirectoryRows(rows: TreeRow[], seenDirs: Set<string>, dirs: string[]): void {
  let dirPath = ""
  for (const [depth, dir] of dirs.entries()) {
    dirPath = dirPath ? `${dirPath}/${dir}` : dir
    if (!seenDirs.has(dirPath)) {
      seenDirs.add(dirPath)
      rows.push({ label: dir, depth, isLast: false })
    }
  }
}

function addFileRow(rows: TreeRow[], seenDirs: Set<string>, info: IndexedDiffFile): void {
  const displayParts = info.file.path.split("/").filter(Boolean)
  addDirectoryRows(rows, seenDirs, displayParts.slice(0, -1))
  rows.push({
    label: `${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}`,
    fileIndex: info.index,
    depth: Math.max(0, displayParts.length - 1),
    isLast: true,
  })
}

function buildTreeRows(files: DiffFile[]): TreeRow[] {
  const rows: TreeRow[] = []
  const seenDirs = new Set<string>()
  const byPath = new Map(files.map((file, index) => [file.path, { file, index }]))
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const info = byPath.get(file.path)
    if (info) {
      addFileRow(rows, seenDirs, info)
    }
  }
  return rows
}

class DiffViewer {
  private document: DiffDocument
  private readonly pi: ExtensionAPI
  private readonly ctx: ExtensionCommandContext
  private readonly theme: Theme
  private readonly done: () => void
  private readonly requestRender: () => void

  private selectedFileIndex = 0
  private diffScroll = 0
  private commitScroll = 0
  private selectedCommitIndex = 0
  private focusedPanel: FocusPanel = "tree"
  private commits: CommitSummary[] = []
  private commitSearchQuery = ""
  private pickerState: "closed" | "loading" | "open" = "closed"
  private loadingMessage: string | undefined
  private error: string | undefined

  constructor(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    theme: Theme,
    document: DiffDocument,
    done: () => void,
    requestRender: () => void,
    private readonly getTerminalRows: () => number,
  ) {
    this.pi = pi
    this.ctx = ctx
    this.theme = theme
    this.document = document
    this.done = done
    this.requestRender = requestRender
    this.resetSelectionToFirstTreeFile()
  }

  handleInput(data: string): void {
    if (this.pickerState !== "closed") {
      this.handleCommitPickerInput(data)
      return
    }
    if (this.handleCloseInput(data) || this.handleOpenPickerInput(data)) {
      return
    }
    this.handleViewerNavigationInput(data)
    this.requestRender()
  }

  invalidate(): void {
    // The viewer renders from current git data only; there is no cached external state to invalidate.
  }

  private handleCloseInput(data: string): boolean {
    if (!this.isKey(data, "q") && !matchesKey(data, "escape")) {
      return false
    }
    this.done()
    return true
  }

  private handleOpenPickerInput(data: string): boolean {
    if (!this.isKey(data, "c")) {
      return false
    }
    this.openCommitPicker().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  private handleViewerNavigationInput(data: string): void {
    const handlers = [
      () => this.handleFocusToggle(data),
      () => this.handleFileStep(data),
      () => this.handleArrowScroll(data),
      () => this.handlePageScroll(data),
      () => this.handleEdgeJump(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  private handleFocusToggle(data: string): boolean {
    if (!matchesKey(data, "tab")) {
      return false
    }
    this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree"
    return true
  }

  private handleFileStep(data: string): boolean {
    if (this.isKey(data, "n")) {
      this.moveFile(1)
      return true
    }
    if (this.isKey(data, "p")) {
      this.moveFile(-1)
      return true
    }
    return false
  }

  private handleArrowScroll(data: string): boolean {
    const delta = this.arrowScrollDelta(data)
    if (delta === 0) {
      return false
    }
    if (this.focusedPanel === "tree") {
      this.moveFile(delta)
    } else {
      this.scrollDiff(delta)
    }
    return true
  }

  private arrowScrollDelta(data: string): number {
    if (matchesKey(data, "up") || this.isKey(data, "k")) {
      return -1
    }
    if (matchesKey(data, "down") || this.isKey(data, "j")) {
      return 1
    }
    return 0
  }

  private handlePageScroll(data: string): boolean {
    if (isPageUp(data)) {
      this.scrollDiff(-this.pageScrollSize())
      return true
    }
    if (isPageDown(data) || matchesKey(data, "space")) {
      this.scrollDiff(this.pageScrollSize())
      return true
    }
    return false
  }

  private handleEdgeJump(data: string): boolean {
    if (matchesKey(data, "home")) {
      this.jumpToEdge("first")
      return true
    }
    if (matchesKey(data, "end")) {
      this.jumpToEdge("last")
      return true
    }
    return false
  }

  private jumpToEdge(edge: "first" | "last"): void {
    if (this.focusedPanel === "tree") {
      this.selectTreeEdge(edge)
      return
    }
    this.diffScroll = edge === "first" ? 0 : Number.MAX_SAFE_INTEGER
  }

  private isKey(data: string, key: string): boolean {
    return data === key || data === key.toUpperCase()
  }

  private showAsyncError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error)
    this.pickerState = "closed"
    this.loadingMessage = undefined
    this.requestRender()
  }

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
    if (this.pickerState !== "closed") {
      return this.renderCommitPickerOverlay(lines, width)
    }
    return lines.map((line) => fit(line, width))
  }

  private viewHeight(): number {
    // The custom diff viewer is shown as an overlay with a 1-row margin. Keep the
    // component shorter than the visible terminal so re-renders never push content
    // into scrollback when users browse with arrow keys or PageUp/PageDown.
    const maxTotalLines = Math.max(10, this.getTerminalRows() - 2)
    const chromeLines = 7 // border, header, subtitle, dividers, footer, border
    return Math.max(5, Math.min(MAX_VIEW_HEIGHT, maxTotalLines - chromeLines))
  }

  private pageScrollSize(): number {
    return Math.max(1, Math.floor((this.viewHeight() - 1) / 2))
  }

  private renderHeader(width: number): string {
    const fileCount = this.document.files.length
    const count = fileCount === 1 ? "1 file" : `${fileCount} files`
    const title = `${this.theme.bold(this.document.title)} ${this.theme.fg("muted", `(${count})`)}`
    return fit(title, width)
  }

  private renderSubtitle(width: number): string {
    return fit(this.theme.fg("dim", this.document.subtitle || " "), width)
  }

  private renderPanelTitle(panel: FocusPanel, width: number): string {
    const focused = this.focusedPanel === panel
    const label = panel === "tree" ? "Files" : "Diff"
    const marker = focused ? "▶ " : "  "
    const text = `${marker}${label}`
    return fit(focused ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text), width)
  }

  private renderFooter(width: number): string {
    if (this.error) {
      return fit(this.theme.fg("warning", `⚠ ${this.error} • q close`), width)
    }
    const focusLabel = this.focusedPanel === "tree" ? "files" : "diff"
    const arrows = this.focusedPanel === "tree" ? "↑↓/j/k files" : "↑↓/j/k code"
    return fit(
      this.theme.fg(
        "dim",
        `focus:${focusLabel} • tab switch • n/p files • ${arrows} • PgUp/PgDn scroll • Home/End jump • c commits • q close`,
      ),
      width,
    )
  }

  private renderTree(width: number, height: number): string[] {
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
      const colored =
        row.fileIndex === undefined
          ? this.theme.fg("muted", raw)
          : this.colorTreeFile(raw, this.document.files[row.fileIndex]?.status ?? "modified", isSelected)
      return fit(isSelected && isTreeFocused ? this.theme.bg("selectedBg", colored) : colored, width)
    })
    while (lines.length < height) {
      lines.push(" ".repeat(width))
    }
    return lines
  }

  private colorTreeFile(line: string, status: DiffFile["status"], selected: boolean): string {
    const color = selected ? "accent" : TREE_STATUS_COLORS[status]
    return this.theme.fg(color, line)
  }

  private renderDiff(width: number, height: number): string[] {
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

  private colorDiffLine(line: string): string {
    const rule = DIFF_LINE_STYLE_RULES.find(({ matches }) => matches(line))
    if (!rule) {
      return this.theme.fg("toolDiffContext", line)
    }
    return this.theme.fg(rule.color, rule.bold ? this.theme.bold(line) : line)
  }

  private moveFile(delta: number): void {
    const fileOrder = this.treeFileOrder()
    if (fileOrder.length === 0) {
      return
    }
    const currentOrderIndex = Math.max(0, fileOrder.indexOf(this.selectedFileIndex))
    const nextOrderIndex = Math.max(0, Math.min(fileOrder.length - 1, currentOrderIndex + delta))
    this.selectedFileIndex = fileOrder[nextOrderIndex] ?? this.selectedFileIndex
    this.diffScroll = 0
  }

  private selectTreeEdge(edge: "first" | "last"): void {
    const fileOrder = this.treeFileOrder()
    if (fileOrder.length === 0) {
      return
    }
    this.selectedFileIndex = fileOrder[edge === "first" ? 0 : fileOrder.length - 1] ?? this.selectedFileIndex
    this.diffScroll = 0
  }

  private treeFileOrder(): number[] {
    return buildTreeRows(this.document.files)
      .map((row) => row.fileIndex)
      .filter((index): index is number => index !== undefined)
  }

  private scrollDiff(delta: number): void {
    this.diffScroll = Math.max(0, this.diffScroll + delta)
  }

  private resetSelectionToFirstTreeFile(): void {
    this.selectedFileIndex = this.treeFileOrder()[0] ?? 0
    this.diffScroll = 0
  }

  private async openCommitPicker(): Promise<void> {
    this.error = undefined
    this.pickerState = "loading"
    this.loadingMessage = "Loading commits…"
    this.requestRender()
    try {
      this.commits = await loadCommits(this.pi, this.ctx.cwd, this.ctx.signal)
      this.pickerState = "open"
    } catch (error) {
      this.pickerState = "closed"
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private handleCommitPickerInput(data: string): void {
    if (this.closeCommitPickerOnEscape(data) || this.pickerState === "loading") {
      return
    }
    this.updateCommitPickerInput(data)
    this.clampCommitSelection()
    this.requestRender()
  }

  private closeCommitPickerOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.pickerState = "closed"
    this.requestRender()
    return true
  }

  private updateCommitPickerInput(data: string): void {
    const handlers = [
      () => this.handleCommitSearchBackspace(data),
      () => this.handleCommitSearchText(data),
      () => this.handleCommitSelectionMove(data),
      () => this.handleCommitSelection(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  private handleCommitSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.commitSearchQuery = [...this.commitSearchQuery].slice(0, -1).join("")
    this.resetCommitPickerScroll()
    return true
  }

  private isBackspace(data: string): boolean {
    return matchesKey(data, "backspace") || data === "\b" || data === "\x7f"
  }

  private handleCommitSearchText(data: string): boolean {
    if (!isPrintableInput(data)) {
      return false
    }
    this.commitSearchQuery += data
    this.resetCommitPickerScroll()
    return true
  }

  private handleCommitSelectionMove(data: string): boolean {
    const nextIndex = this.nextCommitSelectionIndex(data)
    if (nextIndex === undefined) {
      return false
    }
    this.selectedCommitIndex = nextIndex
    return true
  }

  private nextCommitSelectionIndex(data: string): number | undefined {
    const itemCount = this.commitPickerItemCount()
    const lastIndex = Math.max(0, itemCount - 1)
    if (matchesKey(data, "up")) {
      return Math.max(0, this.selectedCommitIndex - 1)
    }
    if (matchesKey(data, "down")) {
      return Math.min(lastIndex, this.selectedCommitIndex + 1)
    }
    return this.nextCommitSelectionPageIndex(data, lastIndex)
  }

  private nextCommitSelectionPageIndex(data: string, lastIndex: number): number | undefined {
    if (isPageUp(data)) {
      return Math.max(0, this.selectedCommitIndex - 10)
    }
    if (isPageDown(data)) {
      return Math.min(lastIndex, this.selectedCommitIndex + 10)
    }
    if (matchesKey(data, "home")) {
      return 0
    }
    if (matchesKey(data, "end")) {
      return lastIndex
    }
  }

  private handleCommitSelection(data: string): boolean {
    if (!isEnter(data)) {
      return false
    }
    const item = this.commitPickerItem(this.selectedCommitIndex)
    if (item?.type === "working") {
      this.selectWorkingTree().catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    if (item?.type === "commit") {
      this.selectCommit(item.commit).catch((error: unknown) => this.showAsyncError(error))
      return true
    }
    return false
  }

  private resetCommitPickerScroll(): void {
    this.selectedCommitIndex = 0
    this.commitScroll = 0
  }

  private clampCommitSelection(): void {
    this.selectedCommitIndex = Math.max(
      0,
      Math.min(Math.max(0, this.commitPickerItemCount() - 1), this.selectedCommitIndex),
    )
  }

  private commitPickerItemCount(): number {
    return this.commitPickerItems().length
  }

  private commitPickerItem(index: number): CommitPickerItem | undefined {
    return this.commitPickerItems()[index]
  }

  private commitPickerItems(): CommitPickerItem[] {
    const workingItem: CommitPickerItem = { type: "working" }
    const commitItems = this.commits.map((commit): CommitPickerItem => ({ type: "commit", commit }))
    const tokens = this.commitSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) {
      return [workingItem, ...commitItems]
    }

    const items: CommitPickerItem[] = []
    if (this.matchesCommitSearch("working tree staged unstaged", tokens)) {
      items.push(workingItem)
    }
    items.push(
      ...commitItems.filter(
        (item) =>
          item.type === "commit" && this.matchesCommitSearch(`${item.commit.hash} ${item.commit.message}`, tokens),
      ),
    )
    return items
  }

  private matchesCommitSearch(value: string, tokens: string[]): boolean {
    const haystack = value.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  }

  private async selectWorkingTree(): Promise<void> {
    this.pickerState = "loading"
    this.loadingMessage = "Loading working tree…"
    this.requestRender()
    try {
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.pickerState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private renderCommitSearchLine(): string {
    const query =
      this.commitSearchQuery.length > 0
        ? `${this.commitSearchQuery}▌`
        : this.theme.fg("muted", "type to filter commits")
    const matchCount = this.commitPickerItems().filter((item) => item.type === "commit").length
    const countLabel =
      this.commitSearchQuery.trim().length > 0
        ? ` ${this.theme.fg("muted", `(${matchCount}/${this.commits.length})`)}`
        : ""
    return ` Search: ${query}${countLabel}`
  }

  private async selectCommit(commit: CommitSummary): Promise<void> {
    this.pickerState = "loading"
    this.loadingMessage = `Loading ${commit.hash}…`
    this.requestRender()
    try {
      this.document = await loadCommitDiff(this.pi, this.ctx.cwd, commit, this.ctx.signal)
      this.resetSelectionToFirstTreeFile()
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.pickerState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private renderCommitPickerOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitPickerOverlayLines(layout)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  private commitPickerOverlayLayout(baseLineCount: number, width: number) {
    const overlayWidth = Math.max(50, Math.min(width - 4, 88))
    const startLine = 5
    return {
      overlayWidth,
      leftPad: Math.max(0, Math.floor((width - overlayWidth) / 2)),
      startLine,
      maxItems: Math.max(1, Math.min(13, baseLineCount - startLine - 7)),
    }
  }

  private commitPickerOverlayLines(layout: { overlayWidth: number; maxItems: number }): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    return [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Select commit"))}`),
      row(` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter select • esc cancel")}`),
      row(this.renderCommitSearchLine()),
      row(""),
      ...this.commitPickerBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
  }

  private commitPickerOverlayRow(content: string, overlayWidth: number): string {
    const inner = fit(content, overlayWidth - 2)
    return `${this.theme.fg("border", "│")}${inner}${this.theme.fg("border", "│")}`
  }

  private commitPickerBorder(edge: "top" | "bottom", overlayWidth: number): string {
    const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"]
    return this.theme.fg("border", `${left}${"─".repeat(overlayWidth - 2)}${right}`)
  }

  private commitPickerBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.pickerState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`)]
    }
    this.clampCommitSelection()
    if (this.commitPickerItemCount() === 0) {
      return [row(` ${this.theme.fg("muted", "No matching commits")}`)]
    }
    return this.visibleCommitPickerItems(maxItems).map(({ item, index }) =>
      row(this.renderCommitPickerItem(item, index)),
    )
  }

  private visibleCommitPickerItems(maxItems: number): Array<{ item: CommitPickerItem; index: number }> {
    this.updateCommitScroll(maxItems)
    const visibleItems: Array<{ item: CommitPickerItem; index: number }> = []
    const end = Math.min(this.commitPickerItemCount(), this.commitScroll + maxItems)
    for (let index = this.commitScroll; index < end; index++) {
      const item = this.commitPickerItem(index)
      if (item) {
        visibleItems.push({ item, index })
      }
    }
    return visibleItems
  }

  private updateCommitScroll(maxItems: number): void {
    const maxScroll = Math.max(0, this.commitPickerItemCount() - maxItems)
    const centeredScroll = Math.max(0, this.selectedCommitIndex - Math.floor(maxItems / 2))
    this.commitScroll = Math.max(0, Math.min(this.commitScroll, maxScroll, centeredScroll))
    if (this.selectedCommitIndex < this.commitScroll) {
      this.commitScroll = this.selectedCommitIndex
    }
    if (this.selectedCommitIndex >= this.commitScroll + maxItems) {
      this.commitScroll = this.selectedCommitIndex - maxItems + 1
    }
  }

  private renderCommitPickerItem(item: CommitPickerItem, index: number): string {
    const selected = index === this.selectedCommitIndex
    const marker = selected ? "▶" : " "
    const line =
      item.type === "working" ? this.renderWorkingTreePickerItem(marker) : this.renderCommitPickerCommit(item, marker)
    return selected ? this.theme.bg("selectedBg", line) : line
  }

  private renderWorkingTreePickerItem(marker: string): string {
    return ` ${marker} ${this.theme.fg("accent", "working tree")} ${this.theme.fg("muted", "staged + unstaged")}`
  }

  private renderCommitPickerCommit(item: { type: "commit"; commit: CommitSummary }, marker: string): string {
    return ` ${marker} ${this.theme.fg("accent", item.commit.hash)} ${item.commit.message}`
  }

  private applyCommitPickerOverlay(
    baseLines: string[],
    overlay: string[],
    layout: { overlayWidth: number; leftPad: number; startLine: number },
    width: number,
  ): string[] {
    const result = [...baseLines]
    for (let index = 0; index < overlay.length; index++) {
      result[layout.startLine + index] = this.mergeOverlayLine(
        result[layout.startLine + index],
        overlay[index] ?? "",
        layout,
        width,
      )
    }
    return result.map((line) => fit(line, width))
  }

  private mergeOverlayLine(
    baseLine: string | undefined,
    overlayLine: string,
    layout: { overlayWidth: number; leftPad: number },
    width: number,
  ): string {
    const base = stripAnsi(baseLine ?? "")
    const prefix = base.slice(0, layout.leftPad).padEnd(layout.leftPad, " ")
    const suffixStart = layout.leftPad + layout.overlayWidth
    const suffix = suffixStart < base.length ? base.slice(suffixStart) : ""
    return fit(prefix + overlayLine + suffix, width)
  }
}

export default function gitDiffExtension(pi: ExtensionAPI) {
  pi.registerCommand("diff", {
    description: "Open an interactive git diff and commit viewer",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/diff requires interactive mode", "error")
        return
      }

      let initialDocument: DiffDocument
      try {
        initialDocument = await loadWorkingTreeDiff(pi, ctx)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        initialDocument = emptyDocument("Failed to load git diff", message, "working")
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new DiffViewer(
            pi,
            ctx,
            theme,
            initialDocument,
            () => done(undefined),
            () => tui.requestRender(),
            () => tui.terminal.rows,
          ),
        {
          overlay: true,
          overlayOptions: {
            width: "100%",
            maxHeight: "100%",
            anchor: "center",
            margin: 1,
          },
        },
      )
    },
  })
}
