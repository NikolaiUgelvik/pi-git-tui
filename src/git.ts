import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import {
  createAgentSession,
  type ExtensionAPI,
  type ExtensionCommandContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { buildDocument, emptyDocument } from "./diff-parser.js"
import {
  COMMIT_LIMIT,
  type CommitSummary,
  type DiffDocument,
  GIT_TIMEOUT_MS,
  type GitCommand,
  type GitExecResult,
  MAX_COMMIT_MESSAGE_DIFF_CHARS,
  MAX_UNTRACKED_FILE_BYTES,
} from "./types.js"

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

export async function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<DiffDocument> {
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

export async function loadCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]> {
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

export async function loadCommitDiff(
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

export async function runGitCommand(
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

export async function stageOrUnstageFile(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
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

export async function runGitCommit(
  pi: ExtensionAPI,
  cwd: string,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
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

export async function generateCommitMessage(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
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
