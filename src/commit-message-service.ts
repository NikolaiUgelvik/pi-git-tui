import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent"
import { stagedDiffForCommitMessage } from "./git-index-service.js"
import { compactGitOutput, ensureGitRepository, runGit } from "./git-service.js"
import { COMMIT_MESSAGE_TIMEOUT_MS } from "./types.js"

interface AssistantTextMessage {
  role: "assistant"
  content: Array<{ type: string; text?: string }>
  stopReason?: string
  errorMessage?: string
}

export interface CommitMessageSession {
  abort(): Promise<void>
  dispose(): void
  messages: unknown[]
  prompt(message: string, options: { expandPromptTemplates: boolean }): Promise<void>
}

export interface CommitMessageGenerationOptions {
  signal?: AbortSignal
  timeoutMs?: number
  createSession?: () => Promise<CommitMessageSession>
  loadStagedDiff?: (signal?: AbortSignal) => Promise<string>
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

function createBackgroundSessionManager(ctx: ExtensionContext): SessionManager {
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

function commitMessagePrompt(diff: string): string {
  return `Generate one concise Conventional Commit message for these staged changes.\n\nRequirements:\n- Return only the commit message.\n- Use a single line.\n- Keep it under 72 characters if possible.\n- Use an appropriate type such as feat, fix, docs, refactor, test, chore.\n\nStaged diff:\n${diff}`
}

async function defaultSession(pi: ExtensionAPI, ctx: ExtensionContext): Promise<CommitMessageSession> {
  if (!ctx.model) {
    throw new Error("No model selected")
  }
  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    model: ctx.model,
    thinkingLevel: pi.getThinkingLevel(),
    modelRegistry: ctx.modelRegistry,
    sessionManager: createBackgroundSessionManager(ctx),
    noTools: "all",
    tools: [],
  })
  return session
}

class CommitMessageTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Commit message generation timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)
    this.name = "CommitMessageTimeoutError"
  }
}

function generationAbortError(): DOMException {
  return new DOMException("Commit message generation cancelled", "AbortError")
}

interface GenerationCancellation {
  promise: Promise<never>
  dispose: () => void
  isCancelled: () => boolean
  throwIfCancelled: () => void
}

function createGenerationCancellation(signal: AbortSignal | undefined, timeoutMs: number): GenerationCancellation {
  let reason: Error | undefined
  let rejectCancellation!: (error: Error) => void
  const promise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  const cancel = (error: Error): void => {
    if (reason) {
      return
    }
    reason = error
    rejectCancellation(error)
  }
  const onAbort = (): void => cancel(generationAbortError())
  const timeout = setTimeout(() => cancel(new CommitMessageTimeoutError(timeoutMs)), timeoutMs)
  signal?.addEventListener("abort", onAbort, { once: true })
  return {
    promise,
    dispose: () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
    },
    isCancelled: () => reason !== undefined,
    throwIfCancelled: () => {
      if (reason) {
        throw reason
      }
    },
  }
}

function requestSessionAbort(session: CommitMessageSession): void {
  try {
    void session.abort().catch(() => undefined)
  } catch {
    // A provider's abort failure must not block prompt rejection or disposal.
  }
}

function disposeSession(session: CommitMessageSession): void {
  try {
    session.dispose()
  } catch {
    // Cleanup failures must not replace the generation outcome.
  }
}

function abortAndDisposeSession(session: CommitMessageSession): void {
  requestSessionAbort(session)
  disposeSession(session)
}

function disposeSessionWhenCreated(sessionTask: Promise<CommitMessageSession>): void {
  void sessionTask.then(abortAndDisposeSession, () => undefined).catch(() => undefined)
}

async function createSessionWithCancellation(
  createSession: () => Promise<CommitMessageSession>,
  cancellation: GenerationCancellation,
): Promise<CommitMessageSession> {
  cancellation.throwIfCancelled()
  const sessionTask = createSession()
  let session: CommitMessageSession | undefined
  try {
    session = await Promise.race([sessionTask, cancellation.promise])
    if (cancellation.isCancelled()) {
      abortAndDisposeSession(session)
      cancellation.throwIfCancelled()
    }
    return session
  } catch (error) {
    if (cancellation.isCancelled() && !session) {
      disposeSessionWhenCreated(sessionTask)
    }
    throw error
  }
}

async function promptWithCancellation(
  session: CommitMessageSession,
  prompt: string,
  cancellation: GenerationCancellation,
): Promise<void> {
  if (cancellation.isCancelled()) {
    requestSessionAbort(session)
    cancellation.throwIfCancelled()
  }
  const promptTask = session.prompt(prompt, { expandPromptTemplates: false })
  try {
    await Promise.race([promptTask, cancellation.promise])
  } catch (error) {
    if (cancellation.isCancelled()) {
      requestSessionAbort(session)
    }
    throw error
  }
  if (cancellation.isCancelled()) {
    requestSessionAbort(session)
    cancellation.throwIfCancelled()
  }
}

function assertGenerationAvailable(ctx: ExtensionContext, options: CommitMessageGenerationOptions): void {
  if (!ctx.model && !options.createSession) {
    throw new Error("No model selected")
  }
  const signal = options.signal ?? ctx.signal
  if (signal?.aborted) {
    throw generationAbortError()
  }
}

function loadGenerationDiff(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: CommitMessageGenerationOptions,
  signal: AbortSignal | undefined,
): Promise<string> {
  return options.loadStagedDiff ? options.loadStagedDiff(signal) : stagedDiffForCommitMessage(pi, ctx.cwd, signal)
}

function generatedMessageFromSession(session: CommitMessageSession): string {
  const response = lastAssistantTextMessage(session.messages)
  if (!response) {
    throw new Error("Background session did not return an assistant message")
  }
  const message = cleanGeneratedCommitMessage(textFromAssistantMessage(response))
  if (message) {
    return message
  }
  const contentTypes = response.content.map((part) => part.type).join(", ") || "none"
  const reason = response.errorMessage ?? `stop reason: ${response.stopReason}; content: ${contentTypes}`
  throw new Error(`Model returned an empty commit message (${reason})`)
}

export async function generateCommitMessage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: CommitMessageGenerationOptions = {},
): Promise<string> {
  assertGenerationAvailable(ctx, options)
  const signal = options.signal ?? ctx.signal
  const cancellation = createGenerationCancellation(signal, options.timeoutMs ?? COMMIT_MESSAGE_TIMEOUT_MS)
  let session: CommitMessageSession | undefined

  try {
    const diff = await Promise.race([loadGenerationDiff(pi, ctx, options, signal), cancellation.promise])
    const createSession = options.createSession ?? (() => defaultSession(pi, ctx))
    session = await createSessionWithCancellation(createSession, cancellation)
    await promptWithCancellation(session, commitMessagePrompt(diff), cancellation)
    return generatedMessageFromSession(session)
  } finally {
    cancellation.dispose()
    if (session) {
      disposeSession(session)
    }
  }
}

export async function runGitCommit(
  pi: ExtensionAPI,
  cwd: string,
  message: string,
  signal?: AbortSignal,
  amend = false,
): Promise<string> {
  const root = await ensureGitRepository(pi, cwd, signal)
  if (!root) {
    throw new Error("Not a git repository")
  }
  if (!amend) {
    const stagedResult = await runGit(pi, root, ["diff", "--cached", "--quiet", "--"], {
      signal,
      acceptedExitCodes: [0, 1],
    })
    if (stagedResult.code === 0) throw new Error("No staged changes to commit")
  }
  const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message]
  const result = await runGit(pi, root, args, { signal, timeoutClass: "mutation" })
  return compactGitOutput(result) || "Commit complete"
}
