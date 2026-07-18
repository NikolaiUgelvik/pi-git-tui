import {
  type AgentSession,
  createAgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { collectCommitDiffInput } from "./commit-diff-input.js"
import { DEFAULT_COMMIT_PROMPT_BUDGET } from "./diff-budgets.js"
import { compactGitOutput, ensureGitRepository, runGit, throwIfGitAborted } from "./git-service.js"

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

export async function promptAgentWithAbort(
  session: Pick<AgentSession, "abort" | "prompt" | "subscribe">,
  prompt: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfGitAborted(signal)
  const abortPromises: Promise<void>[] = []
  const abortSession = () => {
    abortPromises.push(session.abort().catch(() => undefined))
  }
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start" && signal?.aborted) abortSession()
  })
  signal?.addEventListener("abort", abortSession, { once: true })
  try {
    throwIfGitAborted(signal)
    await session.prompt(prompt, { expandPromptTemplates: false })
    throwIfGitAborted(signal)
  } finally {
    signal?.removeEventListener("abort", abortSession)
    unsubscribe()
    await Promise.all(abortPromises)
  }
}

export async function generateCommitMessage(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  if (!ctx.model) {
    throw new Error("No model selected")
  }
  const input = await collectCommitDiffInput(pi, ctx.cwd, DEFAULT_COMMIT_PROMPT_BUDGET, ctx.signal)
  const prompt = commitMessagePrompt(input.text)
  if (prompt.length > DEFAULT_COMMIT_PROMPT_BUDGET.maxPromptChars) {
    throw new Error("Commit message prompt exceeded its configured character budget")
  }
  throwIfGitAborted(ctx.signal)
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
    await promptAgentWithAbort(session, prompt, ctx.signal)
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
  const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message]
  const result = await runGit(pi, root, args, { signal, timeoutClass: "mutation" })
  return compactGitOutput(result) || "Commit complete"
}
