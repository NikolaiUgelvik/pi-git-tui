import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import {
  createAgentSession,
  type ExtensionAPI,
  type ExtensionCommandContext,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent"
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const MAX_VIEW_HEIGHT = 34
const COMMIT_LIMIT = 200
const GIT_TIMEOUT_MS = 10_000
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024
const MAX_COMMIT_MESSAGE_DIFF_CHARS = 24_000

type DiffMode = "working" | "commit"

interface CommitSummary {
  hash: string
  message: string
}

type CommitPickerItem = { type: "working" } | { type: "commit"; commit: CommitSummary }

interface GitCommand {
  label: string
  description: string
  args: string[]
  refreshDiff: boolean
}

interface DiffFile {
  path: string
  oldPath?: string
  newPath?: string
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary"
  staged: boolean
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
type HelpContext = "viewer" | "commitPicker" | "commandMenu" | "commitDialog"
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

const GIT_COMMANDS: GitCommand[] = [
  { label: "Fetch", description: "Fetch updates from the default remote", args: ["fetch"], refreshDiff: false },
  { label: "Pull", description: "Pull updates into the current branch", args: ["pull"], refreshDiff: true },
  {
    label: "Pull (Rebase)",
    description: "Pull updates and rebase local commits",
    args: ["pull", "--rebase"],
    refreshDiff: true,
  },
  { label: "Push", description: "Push the current branch", args: ["push"], refreshDiff: false },
  {
    label: "Force Push",
    description: "Push the current branch with --force-with-lease",
    args: ["push", "--force-with-lease"],
    refreshDiff: false,
  },
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
    staged: false,
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
  stagedPaths = new Set<string>(),
): DiffDocument {
  const files = parseDiff(raw).map((file) => ({ ...file, staged: stagedPaths.has(file.path) }))
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

async function currentBranchLabel(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const branchResult = await git(pi, cwd, ["branch", "--show-current"], signal)
  const branch = branchResult.stdout.trim()
  if (branchResult.code === 0 && branch) {
    return branch
  }

  const headResult = await git(pi, cwd, ["rev-parse", "--short", "HEAD"], signal)
  const head = headResult.stdout.trim()
  if (headResult.code === 0 && head) {
    return `detached ${head}`
  }
}

function repositoryLabel(root: string, branch: string | undefined): string {
  return branch ? `${root} (${branch})` : root
}

function commitSubtitle(root: string, branch: string | undefined, message: string): string {
  const repo = repositoryLabel(root, branch)
  return message ? `${repo} • ${message}` : repo
}

async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await git(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return []
  }
  return result.stdout.split("\0").filter(Boolean)
}

async function listStagedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>> {
  const result = await git(pi, cwd, ["diff", "--cached", "--name-only", "-z"], signal)
  if (result.code !== 0 || !result.stdout) {
    return new Set()
  }
  return new Set(result.stdout.split("\0").filter(Boolean))
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

  const [headExists, branch] = await Promise.all([
    hasHead(pi, root, ctx.signal),
    currentBranchLabel(pi, root, ctx.signal),
  ])
  const [diffResult, untracked, stagedFiles] = await Promise.all([
    git(pi, root, workingTreeDiffArgs(headExists), ctx.signal),
    listUntrackedFiles(pi, root, ctx.signal),
    listStagedFiles(pi, root, ctx.signal),
  ])
  const untrackedDiffs = await readUntrackedDiffs(pi, root, untracked, ctx.signal)
  const title = headExists ? "Working tree vs HEAD" : "Working tree (no commits yet)"
  return buildDocument(
    "working",
    title,
    repositoryLabel(root, branch),
    joinDiffParts([diffResult.stdout, ...untrackedDiffs]),
    undefined,
    stagedFiles,
  )
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
  const [result, branch] = await Promise.all([
    git(
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
    ),
    currentBranchLabel(pi, root, signal),
  ])
  return buildDocument(
    "commit",
    `Commit ${commit.hash}`,
    commitSubtitle(root, branch, commit.message),
    result.stdout,
    commit,
  )
}

function compactGitOutput(result: GitExecResult): string {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
}

function assertGitSuccess(result: GitExecResult, args: string[]): void {
  if (result.code !== 0) {
    throw new Error(compactGitOutput(result) || `git ${args.join(" ")} failed`)
  }
}

async function runGitCommand(
  pi: ExtensionAPI,
  cwd: string,
  command: GitCommand,
  signal?: AbortSignal,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const result = await git(pi, root, command.args, signal)
  assertGitSuccess(result, command.args)
  const output = compactGitOutput(result)
  return output ? `${command.label} complete: ${output}` : `${command.label} complete`
}

async function hasStagedChanges(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<boolean> {
  const result = await git(pi, cwd, ["diff", "--cached", "--quiet", "--", path], signal)
  if (result.code > 1) {
    throw new Error(compactGitOutput(result) || `git diff --cached failed for ${path}`)
  }
  return result.code === 1
}

async function unstageFile(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<void> {
  const restoreArgs = ["restore", "--staged", "--", path]
  const restoreResult = await git(pi, cwd, restoreArgs, signal)
  if (restoreResult.code === 0) {
    return
  }
  await unstageFileWithoutHead(pi, cwd, path, signal, restoreResult)
}

async function unstageFileWithoutHead(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
  signal: AbortSignal | undefined,
  restoreResult: GitExecResult,
): Promise<void> {
  const resetArgs = ["reset", "--", path]
  const resetResult = await git(pi, cwd, resetArgs, signal)
  if (resetResult.code === 0) {
    return
  }
  const rmCachedArgs = ["rm", "--cached", "--", path]
  const rmCachedResult = await git(pi, cwd, rmCachedArgs, signal)
  if (rmCachedResult.code === 0) {
    return
  }
  throw new Error(compactGitOutput(rmCachedResult) || compactGitOutput(resetResult) || compactGitOutput(restoreResult))
}

async function stageOrUnstageFile(pi: ExtensionAPI, cwd: string, path: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  if (await hasStagedChanges(pi, root, path, signal)) {
    await unstageFile(pi, root, path, signal)
    return `Unstaged ${path}`
  }
  const addArgs = ["add", "--", path]
  assertGitSuccess(await git(pi, root, addArgs, signal), addArgs)
  return `Staged ${path}`
}

async function runGitCommit(pi: ExtensionAPI, cwd: string, message: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const args = ["commit", "-m", message]
  const result = await git(pi, root, args, signal)
  assertGitSuccess(result, args)
  return compactGitOutput(result) || "Commit complete"
}

async function stagedDiffForCommitMessage(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  const statResult = await git(pi, root, ["diff", "--cached", "--stat", "--color=never"], signal)
  const diffResult = await git(pi, root, [...BASE_DIFF_ARGS, "--cached", "--"], signal)
  assertGitSuccess(statResult, ["diff", "--cached", "--stat", "--color=never"])
  assertGitSuccess(diffResult, ["diff", "--cached", "--"])
  const diff = [statResult.stdout.trim(), diffResult.stdout.trim()].filter(Boolean).join("\n\n")
  if (!diff) {
    throw new Error("No staged changes to summarize")
  }
  if (diff.length <= MAX_COMMIT_MESSAGE_DIFF_CHARS) {
    return diff
  }
  return `${diff.slice(0, MAX_COMMIT_MESSAGE_DIFF_CHARS)}\n\n[diff truncated]`
}

function commitMessagePrompt(diff: string): string {
  return `Generate one concise Conventional Commit message for these staged changes.\n\nRequirements:\n- Return only the commit message.\n- Use a single line.\n- Keep it under 72 characters if possible.\n- Use an appropriate type such as feat, fix, docs, refactor, test, chore.\n\nStaged diff:\n${diff}`
}

interface AssistantTextMessage {
  role: "assistant"
  content: Array<{ type: string; text?: string }>
  stopReason?: string
  errorMessage?: string
}

function isAssistantTextMessage(message: unknown): message is AssistantTextMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant" &&
    "content" in message &&
    Array.isArray(message.content)
  )
}

function textFromAssistantMessage(message: AssistantTextMessage): string {
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
}

function cleanGeneratedCommitMessage(text: string): string {
  const firstLine = text
    .trim()
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/u, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  return (firstLine ?? "")
    .replace(/^commit message:\s*/iu, "")
    .replace(/^["'`]|["'`]$/gu, "")
    .trim()
}

function createBackgroundSessionManager(ctx: ExtensionCommandContext): SessionManager {
  const sessionFile = ctx.sessionManager.getSessionFile()
  const leafId = ctx.sessionManager.getLeafId()
  if (!sessionFile || !leafId) {
    throw new Error("Cannot fork the active session for commit message generation")
  }
  const sourceSession = SessionManager.open(sessionFile, ctx.sessionManager.getSessionDir(), ctx.cwd)
  const forkedSessionFile = sourceSession.createBranchedSession(leafId)
  if (!forkedSessionFile) {
    throw new Error("Could not create background session fork")
  }
  return SessionManager.open(forkedSessionFile, ctx.sessionManager.getSessionDir(), ctx.cwd)
}

function lastAssistantTextMessage(messages: unknown[]): AssistantTextMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (isAssistantTextMessage(message)) {
      return message
    }
  }
}

async function generateCommitMessage(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
  if (!ctx.model) {
    throw new Error("No model selected")
  }
  const diff = await stagedDiffForCommitMessage(pi, ctx.cwd, ctx.signal)
  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    model: ctx.model,
    thinkingLevel: pi.getThinkingLevel(),
    modelRegistry: ctx.modelRegistry,
    sessionManager: createBackgroundSessionManager(ctx),
    noTools: "all",
    tools: [],
  })

  try {
    await session.prompt(commitMessagePrompt(diff), { expandPromptTemplates: false })
    const response = lastAssistantTextMessage(session.messages)
    if (!response) {
      throw new Error("Background session did not return an assistant message")
    }
    const message = cleanGeneratedCommitMessage(textFromAssistantMessage(response))
    if (!message) {
      const contentTypes = response.content.map((part) => part.type).join(", ") || "none"
      const reason = response.errorMessage ?? `stop reason: ${response.stopReason}; content: ${contentTypes}`
      throw new Error(`Model returned an empty commit message (${reason})`)
    }
    return message
  } finally {
    session.dispose()
  }
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

function stagedGlyph(file: DiffFile): string {
  return file.staged ? "●" : " "
}

function addFileRow(rows: TreeRow[], seenDirs: Set<string>, info: IndexedDiffFile): void {
  const displayParts = info.file.path.split("/").filter(Boolean)
  addDirectoryRows(rows, seenDirs, displayParts.slice(0, -1))
  rows.push({
    label: `${stagedGlyph(info.file)} ${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}`,
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
  private commandMenuScroll = 0
  private selectedCommandIndex = 0
  private focusedPanel: FocusPanel = "tree"
  private commits: CommitSummary[] = []
  private commitSearchQuery = ""
  private commandMenuSearchQuery = ""
  private commitMessage = ""
  private pickerState: "closed" | "loading" | "open" = "closed"
  private commandMenuState: "closed" | "loading" | "open" = "closed"
  private commitDialogState: "closed" | "loading" | "open" = "closed"
  private helpContext: HelpContext | undefined
  private loadingMessage: string | undefined
  private statusMessage: string | undefined
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
    if (
      this.handleHelpInput(data) ||
      this.handleActiveOverlayInput(data) ||
      this.handleCloseInput(data) ||
      this.handleOpenOverlayInput(data)
    ) {
      return
    }
    this.handleViewerNavigationInput(data)
    this.requestRender()
  }

  invalidate(): void {
    // The viewer renders from current git data only; there is no cached external state to invalidate.
  }

  private handleHelpInput(data: string): boolean {
    if (this.helpContext !== undefined) {
      if (this.isHelpCloseInput(data)) {
        this.helpContext = undefined
        this.requestRender()
      }
      return true
    }
    if (!this.isHelpKey(data)) {
      return false
    }
    this.helpContext = this.currentHelpContext()
    this.requestRender()
    return true
  }

  private isHelpCloseInput(data: string): boolean {
    return this.isHelpKey(data) || matchesKey(data, "escape") || this.isKey(data, "q")
  }

  private isHelpKey(data: string): boolean {
    return data === "?"
  }

  private currentHelpContext(): HelpContext {
    if (this.commitDialogState !== "closed") {
      return "commitDialog"
    }
    if (this.commandMenuState !== "closed") {
      return "commandMenu"
    }
    if (this.pickerState !== "closed") {
      return "commitPicker"
    }
    return "viewer"
  }

  private handleActiveOverlayInput(data: string): boolean {
    if (this.commitDialogState !== "closed") {
      this.handleCommitDialogInput(data)
      return true
    }
    if (this.commandMenuState !== "closed") {
      this.handleCommandMenuInput(data)
      return true
    }
    if (this.pickerState !== "closed") {
      this.handleCommitPickerInput(data)
      return true
    }
    return false
  }

  private handleCloseInput(data: string): boolean {
    if (!this.isKey(data, "q") && !matchesKey(data, "escape")) {
      return false
    }
    this.done()
    return true
  }

  private handleOpenOverlayInput(data: string): boolean {
    const handlers = [
      () => this.handleOpenCommitDialogInput(data),
      () => this.handleOpenPickerInput(data),
      () => this.handleOpenCommandMenuInput(data),
    ]
    return handlers.some((handler) => handler())
  }

  private handleOpenPickerInput(data: string): boolean {
    if (data !== "c") {
      return false
    }
    this.openCommitPicker().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  private handleOpenCommitDialogInput(data: string): boolean {
    if (data !== "C") {
      return false
    }
    this.openCommitDialog()
    return true
  }

  private handleOpenCommandMenuInput(data: string): boolean {
    if (!matchesKey(data, "ctrl+p")) {
      return false
    }
    this.openCommandMenu()
    return true
  }

  private handleViewerNavigationInput(data: string): void {
    const handlers = [
      () => this.handleFocusToggle(data),
      () => this.handleFileStageToggle(data),
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

  private handleFileStageToggle(data: string): boolean {
    if (!isEnter(data) || this.focusedPanel !== "tree") {
      return false
    }
    if (this.document.mode !== "working") {
      this.error = "Staging is only available in the working tree"
      this.statusMessage = undefined
      return true
    }
    const file = this.document.files[this.selectedFileIndex]
    if (!file) {
      return true
    }
    this.toggleSelectedFileStage(file.path).catch((error: unknown) => this.showAsyncError(error))
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
    this.statusMessage = undefined
    this.pickerState = "closed"
    this.commandMenuState = "closed"
    this.commitDialogState = "closed"
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

    return this.renderOverlays(lines, width)
  }

  private renderOverlays(baseLines: string[], width: number): string[] {
    const renderedLines = this.renderActiveOverlay(baseLines, width)
    if (this.helpContext === undefined) {
      return renderedLines
    }
    return this.renderHelpOverlay(renderedLines, width)
  }

  private renderActiveOverlay(baseLines: string[], width: number): string[] {
    if (this.commitDialogState !== "closed") {
      return this.renderCommitDialogOverlay(baseLines, width)
    }
    if (this.commandMenuState !== "closed") {
      return this.renderCommandMenuOverlay(baseLines, width)
    }
    if (this.pickerState !== "closed") {
      return this.renderCommitPickerOverlay(baseLines, width)
    }
    return baseLines.map((line) => fit(line, width))
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
      return fit(this.theme.fg("warning", `⚠ ${this.error} • ? help • q close`), width)
    }
    if (this.statusMessage) {
      return fit(this.theme.fg("success", `✓ ${this.statusMessage} • ? help • q close`), width)
    }
    const focusLabel = this.focusedPanel === "tree" ? "files" : "diff"
    const arrows = this.focusedPanel === "tree" ? "↑↓/j/k files" : "↑↓/j/k code"
    const enterAction = this.focusedPanel === "tree" ? " • Enter stage/unstage" : ""
    return fit(
      this.theme.fg(
        "dim",
        `focus:${focusLabel} • tab switch • n/p files • ${arrows}${enterAction} • PgUp/PgDn scroll • Home/End jump • c commits • C commit • ^P commands • ? help • q close`,
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
      const file = row.fileIndex === undefined ? undefined : this.document.files[row.fileIndex]
      const colored = file ? this.colorTreeFile(raw, file, isSelected) : this.theme.fg("muted", raw)
      return fit(isSelected && isTreeFocused ? this.theme.bg("selectedBg", colored) : colored, width)
    })
    while (lines.length < height) {
      lines.push(" ".repeat(width))
    }
    return lines
  }

  private colorTreeFile(line: string, file: DiffFile, selected: boolean): string {
    const color = selected || file.staged ? "accent" : TREE_STATUS_COLORS[file.status]
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

  private selectFileByPath(path: string): boolean {
    const fileIndex = this.document.files.findIndex((file) => file.path === path)
    if (fileIndex < 0) {
      return false
    }
    this.selectedFileIndex = fileIndex
    this.diffScroll = 0
    return true
  }

  private async refreshWorkingTreePreservingFile(path: string): Promise<void> {
    this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
    if (!this.selectFileByPath(path)) {
      this.resetSelectionToFirstTreeFile()
    }
  }

  private async toggleSelectedFileStage(path: string): Promise<void> {
    this.error = undefined
    this.statusMessage = `Updating ${path}…`
    this.requestRender()
    try {
      const message = await stageOrUnstageFile(this.pi, this.ctx.cwd, path, this.ctx.signal)
      await this.refreshWorkingTreePreservingFile(path)
      this.statusMessage = message
    } catch (error) {
      this.statusMessage = undefined
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.requestRender()
    }
  }

  private searchTokens(query: string): string[] {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  }

  private matchesSearch(value: string, tokens: string[]): boolean {
    const haystack = value.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  }

  private nextListSelectionIndex(data: string, selectedIndex: number, itemCount: number): number | undefined {
    const lastIndex = Math.max(0, itemCount - 1)
    if (matchesKey(data, "up")) {
      return Math.max(0, selectedIndex - 1)
    }
    if (matchesKey(data, "down")) {
      return Math.min(lastIndex, selectedIndex + 1)
    }
    return this.nextListSelectionPageIndex(data, selectedIndex, lastIndex)
  }

  private nextListSelectionPageIndex(data: string, selectedIndex: number, lastIndex: number): number | undefined {
    if (isPageUp(data)) {
      return Math.max(0, selectedIndex - 10)
    }
    if (isPageDown(data)) {
      return Math.min(lastIndex, selectedIndex + 10)
    }
    if (matchesKey(data, "home")) {
      return 0
    }
    if (matchesKey(data, "end")) {
      return lastIndex
    }
  }

  private nextListScroll(selectedIndex: number, currentScroll: number, itemCount: number, maxItems: number): number {
    const maxScroll = Math.max(0, itemCount - maxItems)
    const centeredScroll = Math.max(0, selectedIndex - Math.floor(maxItems / 2))
    let scroll = Math.max(0, Math.min(currentScroll, maxScroll, centeredScroll))
    if (selectedIndex < scroll) {
      scroll = selectedIndex
    }
    if (selectedIndex >= scroll + maxItems) {
      scroll = selectedIndex - maxItems + 1
    }
    return scroll
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
    return this.nextListSelectionIndex(data, this.selectedCommitIndex, this.commitPickerItemCount())
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
    const tokens = this.searchTokens(this.commitSearchQuery)
    if (tokens.length === 0) {
      return [workingItem, ...commitItems]
    }

    const items: CommitPickerItem[] = []
    if (this.matchesSearch("working tree staged unstaged", tokens)) {
      items.push(workingItem)
    }
    items.push(
      ...commitItems.filter(
        (item) => item.type === "commit" && this.matchesSearch(`${item.commit.hash} ${item.commit.message}`, tokens),
      ),
    )
    return items
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

  private openCommitDialog(): void {
    this.error = undefined
    this.statusMessage = undefined
    this.commitDialogState = "open"
    this.requestRender()
  }

  private handleCommitDialogInput(data: string): void {
    if (this.commitDialogState === "loading" || this.closeCommitDialogOnEscape(data)) {
      return
    }
    this.updateCommitDialogInput(data)
    this.requestRender()
  }

  private closeCommitDialogOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.commitDialogState = "closed"
    this.requestRender()
    return true
  }

  private updateCommitDialogInput(data: string): void {
    const handlers = [
      () => this.handleCommitMessageGeneration(data),
      () => this.handleCommitMessageBackspace(data),
      () => this.handleCommitSubmission(data),
      () => this.handleCommitMessageText(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  private handleCommitMessageGeneration(data: string): boolean {
    if (data !== "*") {
      return false
    }
    this.generateCommitMessageIntoDialog().catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  private handleCommitMessageBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.commitMessage = [...this.commitMessage].slice(0, -1).join("")
    return true
  }

  private handleCommitSubmission(data: string): boolean {
    if (!isEnter(data)) {
      return false
    }
    const message = this.commitMessage.trim()
    if (!message) {
      this.error = "Commit message is empty"
      this.statusMessage = undefined
      return true
    }
    this.commitStagedChanges(message).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  private handleCommitMessageText(data: string): boolean {
    if (!isPrintableInput(data)) {
      return false
    }
    this.commitMessage += data
    return true
  }

  private async generateCommitMessageIntoDialog(): Promise<void> {
    this.commitDialogState = "loading"
    this.loadingMessage = "Generating commit message…"
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      this.commitMessage = await generateCommitMessage(this.pi, this.ctx)
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.commitDialogState = "open"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private async commitStagedChanges(message: string): Promise<void> {
    this.commitDialogState = "loading"
    this.loadingMessage = "Committing staged changes…"
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      const output = await runGitCommit(this.pi, this.ctx.cwd, message, this.ctx.signal)
      this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
      this.resetSelectionToFirstTreeFile()
      this.commitMessage = ""
      this.commitDialogState = "closed"
      this.statusMessage = output
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.commitDialogState = "open"
    } finally {
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private openCommandMenu(): void {
    this.error = undefined
    this.statusMessage = undefined
    this.commandMenuState = "open"
    this.clampCommandSelection()
    this.requestRender()
  }

  private handleCommandMenuInput(data: string): void {
    if (this.closeCommandMenuOnEscape(data) || this.commandMenuState === "loading") {
      return
    }
    this.updateCommandMenuInput(data)
    this.clampCommandSelection()
    this.requestRender()
  }

  private closeCommandMenuOnEscape(data: string): boolean {
    if (!matchesKey(data, "escape")) {
      return false
    }
    this.commandMenuState = "closed"
    this.requestRender()
    return true
  }

  private updateCommandMenuInput(data: string): void {
    const handlers = [
      () => this.handleCommandSearchBackspace(data),
      () => this.handleCommandSearchText(data),
      () => this.handleCommandSelectionMove(data),
      () => this.handleCommandSelection(data),
    ]
    for (const handler of handlers) {
      if (handler()) {
        return
      }
    }
  }

  private handleCommandSearchBackspace(data: string): boolean {
    if (!this.isBackspace(data)) {
      return false
    }
    this.commandMenuSearchQuery = [...this.commandMenuSearchQuery].slice(0, -1).join("")
    this.resetCommandMenuScroll()
    return true
  }

  private handleCommandSearchText(data: string): boolean {
    if (!isPrintableInput(data)) {
      return false
    }
    this.commandMenuSearchQuery += data
    this.resetCommandMenuScroll()
    return true
  }

  private handleCommandSelectionMove(data: string): boolean {
    const nextIndex = this.nextListSelectionIndex(data, this.selectedCommandIndex, this.commandMenuItemCount())
    if (nextIndex === undefined) {
      return false
    }
    this.selectedCommandIndex = nextIndex
    return true
  }

  private handleCommandSelection(data: string): boolean {
    if (!isEnter(data)) {
      return false
    }
    const command = this.commandMenuItem(this.selectedCommandIndex)
    if (!command) {
      return false
    }
    this.runSelectedCommand(command).catch((error: unknown) => this.showAsyncError(error))
    return true
  }

  private resetCommandMenuScroll(): void {
    this.selectedCommandIndex = 0
    this.commandMenuScroll = 0
  }

  private clampCommandSelection(): void {
    this.selectedCommandIndex = Math.max(
      0,
      Math.min(Math.max(0, this.commandMenuItemCount() - 1), this.selectedCommandIndex),
    )
  }

  private commandMenuItemCount(): number {
    return this.commandMenuItems().length
  }

  private commandMenuItem(index: number): GitCommand | undefined {
    return this.commandMenuItems()[index]
  }

  private commandMenuItems(): GitCommand[] {
    const tokens = this.searchTokens(this.commandMenuSearchQuery)
    if (tokens.length === 0) {
      return GIT_COMMANDS
    }
    return GIT_COMMANDS.filter((command) =>
      this.matchesSearch(`${command.label} ${command.description} git ${command.args.join(" ")}`, tokens),
    )
  }

  private async runSelectedCommand(command: GitCommand): Promise<void> {
    this.commandMenuState = "loading"
    this.loadingMessage = `Running ${command.label}…`
    this.error = undefined
    this.statusMessage = undefined
    this.requestRender()
    try {
      const message = await runGitCommand(this.pi, this.ctx.cwd, command, this.ctx.signal)
      await this.refreshDocumentAfterCommand(command)
      this.statusMessage = message
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.commandMenuState = "closed"
      this.loadingMessage = undefined
      this.requestRender()
    }
  }

  private async refreshDocumentAfterCommand(command: GitCommand): Promise<void> {
    if (!command.refreshDiff || this.document.mode !== "working") {
      return
    }
    this.document = await loadWorkingTreeDiff(this.pi, this.ctx)
    this.resetSelectionToFirstTreeFile()
  }

  private renderHelpOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.helpOverlayLines(layout.overlayWidth)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  private helpOverlayLines(overlayWidth: number): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, overlayWidth)
    const context = this.helpContext ?? "viewer"
    return [
      this.commitPickerBorder("top", overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold(this.helpTitle(context)))}`),
      row(` ${this.theme.fg("dim", "press ? / esc / q to close help")}`),
      row(""),
      ...this.helpActions(context).map((action) => row(this.renderHelpAction(action))),
      row(""),
      this.commitPickerBorder("bottom", overlayWidth),
    ]
  }

  private helpTitle(context: HelpContext): string {
    switch (context) {
      case "commitDialog":
        return "Commit dialog help"
      case "commandMenu":
        return "Command menu help"
      case "commitPicker":
        return "Commit picker help"
      case "viewer":
        return "Diff viewer help"
    }
  }

  private helpActions(context: HelpContext): Array<{ keys?: string; action: string }> {
    switch (context) {
      case "commitDialog":
        return [
          { keys: "type", action: "Edit the commit message" },
          { keys: "Backspace", action: "Delete the previous character" },
          { keys: "*", action: "Generate a commit message from staged changes" },
          { keys: "Enter", action: "Commit staged changes with the message" },
          { keys: "Esc", action: "Cancel and close the commit dialog" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "commandMenu":
        return [
          { keys: "type", action: "Filter commands by label, description, or git args" },
          { keys: "Backspace", action: "Delete the previous search character" },
          { keys: "↑/↓", action: "Move to the previous or next command" },
          { keys: "PgUp/PgDn", action: "Jump through commands by page" },
          { keys: "Home/End", action: "Jump to the first or last command" },
          { keys: "Enter", action: "Run the selected git command" },
          { keys: "Esc", action: "Cancel and close the command menu" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "commitPicker":
        return [
          { keys: "type", action: "Filter commits by hash or message" },
          { keys: "Backspace", action: "Delete the previous search character" },
          { keys: "↑/↓", action: "Move to the previous or next entry" },
          { keys: "PgUp/PgDn", action: "Jump through entries by page" },
          { keys: "Home/End", action: "Jump to the first or last entry" },
          { keys: "Enter", action: "Select the working tree or highlighted commit" },
          { keys: "Esc", action: "Cancel and close the commit picker" },
          { keys: "?", action: "Show or close this help" },
        ]
      case "viewer":
        return [
          { keys: "Tab", action: "Switch focus between the file tree and diff" },
          { keys: "↑/↓ or j/k", action: "Move files when focused on Files; scroll code in Diff" },
          { keys: "n / p", action: "Move to the next or previous file" },
          { keys: "Enter", action: "Stage or unstage the selected file in the working tree" },
          { keys: "PgUp/PgDn", action: "Scroll the diff by half a page" },
          { keys: "Space", action: "Scroll the diff down by half a page" },
          { keys: "Home/End", action: "Jump to the first or last file/line" },
          { keys: "c", action: "Open the commit picker" },
          { keys: "C", action: "Open the staged changes commit dialog" },
          { keys: "Ctrl+P", action: "Open the git command menu" },
          { keys: "Esc / q", action: "Close the diff viewer" },
          { keys: "?", action: "Show or close this help" },
        ]
    }
  }

  private renderHelpAction(action: { keys?: string; action: string }): string {
    if (!action.keys) {
      return ` ${this.theme.fg("muted", action.action)}`
    }
    return ` ${this.theme.fg("accent", fit(action.keys, 14))} ${action.action}`
  }

  private renderCommitDialogOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commitDialogOverlayLines(layout.overlayWidth)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  private commitDialogOverlayLines(overlayWidth: number): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, overlayWidth)
    return [
      this.commitPickerBorder("top", overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Commit staged changes"))}`),
      row(` ${this.theme.fg("dim", "type message • * generate • enter commit • ? help • esc cancel")}`),
      row(""),
      ...this.commitDialogBodyRows(row),
      row(""),
      this.commitPickerBorder("bottom", overlayWidth),
    ]
  }

  private commitDialogBodyRows(row: (content: string) => string): string[] {
    if (this.commitDialogState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`)]
    }
    const message = this.commitMessage.length > 0 ? `${this.commitMessage}▌` : this.theme.fg("muted", "commit message")
    return [row(` Message: ${message}`)]
  }

  private renderCommandMenuOverlay(baseLines: string[], width: number): string[] {
    const layout = this.commitPickerOverlayLayout(baseLines.length, width)
    const overlay = this.commandMenuOverlayLines(layout)
    return this.applyCommitPickerOverlay(baseLines, overlay, layout, width)
  }

  private commandMenuOverlayLines(layout: { overlayWidth: number; maxItems: number }): string[] {
    const row = (content: string) => this.commitPickerOverlayRow(content, layout.overlayWidth)
    return [
      this.commitPickerBorder("top", layout.overlayWidth),
      row(` ${this.theme.fg("accent", this.theme.bold("Command menu"))}`),
      row(` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter run • ? help • esc cancel")}`),
      row(this.renderCommandSearchLine()),
      row(""),
      ...this.commandMenuBodyRows(row, layout.maxItems),
      row(""),
      this.commitPickerBorder("bottom", layout.overlayWidth),
    ]
  }

  private renderCommandSearchLine(): string {
    const query =
      this.commandMenuSearchQuery.length > 0
        ? `${this.commandMenuSearchQuery}▌`
        : this.theme.fg("muted", "type to filter commands")
    const countLabel =
      this.commandMenuSearchQuery.trim().length > 0
        ? ` ${this.theme.fg("muted", `(${this.commandMenuItemCount()}/${GIT_COMMANDS.length})`)}`
        : ""
    return ` Search: ${query}${countLabel}`
  }

  private commandMenuBodyRows(row: (content: string) => string, maxItems: number): string[] {
    if (this.commandMenuState === "loading") {
      return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Running…")}`)]
    }
    this.clampCommandSelection()
    if (this.commandMenuItemCount() === 0) {
      return [row(` ${this.theme.fg("muted", "No matching commands")}`)]
    }
    return this.visibleCommandMenuItems(maxItems).map(({ command, index }) =>
      row(this.renderCommandMenuItem(command, index)),
    )
  }

  private visibleCommandMenuItems(maxItems: number): Array<{ command: GitCommand; index: number }> {
    this.updateCommandMenuScroll(maxItems)
    const visibleItems: Array<{ command: GitCommand; index: number }> = []
    const end = Math.min(this.commandMenuItemCount(), this.commandMenuScroll + maxItems)
    for (let index = this.commandMenuScroll; index < end; index++) {
      const command = this.commandMenuItem(index)
      if (command) {
        visibleItems.push({ command, index })
      }
    }
    return visibleItems
  }

  private updateCommandMenuScroll(maxItems: number): void {
    this.commandMenuScroll = this.nextListScroll(
      this.selectedCommandIndex,
      this.commandMenuScroll,
      this.commandMenuItemCount(),
      maxItems,
    )
  }

  private renderCommandMenuItem(command: GitCommand, index: number): string {
    const selected = index === this.selectedCommandIndex
    const marker = selected ? "▶" : " "
    const line = ` ${marker} ${this.theme.fg("accent", command.label)} ${this.theme.fg("muted", command.description)}`
    return selected ? this.theme.bg("selectedBg", line) : line
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
      row(
        ` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter select • ? help • esc cancel")}`,
      ),
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
    this.commitScroll = this.nextListScroll(
      this.selectedCommitIndex,
      this.commitScroll,
      this.commitPickerItemCount(),
      maxItems,
    )
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
