import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { stagedDiffForCommitMessage } from "./git-index-service.js";
import { compactGitOutput, ensureGitRepository, runGit } from "./git-service.js";
import { COMMIT_MESSAGE_TIMEOUT_MS } from "./types.js";
function isAssistantTextMessage(message) {
    return (typeof message === "object" &&
        message !== null &&
        "role" in message &&
        message.role === "assistant" &&
        "content" in message &&
        Array.isArray(message.content));
}
function textFromAssistantMessage(message) {
    return message.content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text ?? "")
        .join("\n");
}
function cleanGeneratedCommitMessage(text) {
    const firstLine = text
        .trim()
        .replace(/^```(?:text)?/i, "")
        .replace(/```$/u, "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
    return (firstLine ?? "")
        .replace(/^commit message:\s*/iu, "")
        .replace(/^["'`]|["'`]$/gu, "")
        .trim();
}
function createBackgroundSessionManager(ctx) {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const leafId = ctx.sessionManager.getLeafId();
    if (!sessionFile || !leafId) {
        throw new Error("Cannot fork the active session for commit message generation");
    }
    const sourceSession = SessionManager.open(sessionFile, ctx.sessionManager.getSessionDir(), ctx.cwd);
    const forkedSessionFile = sourceSession.createBranchedSession(leafId);
    if (!forkedSessionFile) {
        throw new Error("Could not create background session fork");
    }
    return SessionManager.open(forkedSessionFile, ctx.sessionManager.getSessionDir(), ctx.cwd);
}
function lastAssistantTextMessage(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (isAssistantTextMessage(message)) {
            return message;
        }
    }
}
function commitMessagePrompt(diff) {
    return `Generate one concise Conventional Commit message for these staged changes.\n\nRequirements:\n- Return only the commit message.\n- Use a single line.\n- Keep it under 72 characters if possible.\n- Use an appropriate type such as feat, fix, docs, refactor, test, chore.\n\nStaged diff:\n${diff}`;
}
async function defaultSession(pi, ctx) {
    if (!ctx.model) {
        throw new Error("No model selected");
    }
    const { session } = await createAgentSession({
        cwd: ctx.cwd,
        model: ctx.model,
        thinkingLevel: pi.getThinkingLevel(),
        modelRegistry: ctx.modelRegistry,
        sessionManager: createBackgroundSessionManager(ctx),
        noTools: "all",
        tools: [],
    });
    return session;
}
class CommitMessageTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Commit message generation timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
        this.name = "CommitMessageTimeoutError";
    }
}
function generationAbortError() {
    return new DOMException("Commit message generation cancelled", "AbortError");
}
function createGenerationCancellation(signal, timeoutMs) {
    let reason;
    let rejectCancellation;
    const promise = new Promise((_resolve, reject) => {
        rejectCancellation = reject;
    });
    const cancel = (error) => {
        if (reason) {
            return;
        }
        reason = error;
        rejectCancellation(error);
    };
    const onAbort = () => cancel(generationAbortError());
    const timeout = setTimeout(() => cancel(new CommitMessageTimeoutError(timeoutMs)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    return {
        promise,
        dispose: () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
        },
        isCancelled: () => reason !== undefined,
        throwIfCancelled: () => {
            if (reason) {
                throw reason;
            }
        },
    };
}
function requestSessionAbort(session) {
    try {
        void session.abort().catch(() => undefined);
    }
    catch {
        // A provider's abort failure must not block prompt rejection or disposal.
    }
}
function disposeSession(session) {
    try {
        session.dispose();
    }
    catch {
        // Cleanup failures must not replace the generation outcome.
    }
}
function abortAndDisposeSession(session) {
    requestSessionAbort(session);
    disposeSession(session);
}
function disposeSessionWhenCreated(sessionTask) {
    void sessionTask.then(abortAndDisposeSession, () => undefined).catch(() => undefined);
}
async function createSessionWithCancellation(createSession, cancellation) {
    cancellation.throwIfCancelled();
    const sessionTask = createSession();
    let session;
    try {
        session = await Promise.race([sessionTask, cancellation.promise]);
        if (cancellation.isCancelled()) {
            abortAndDisposeSession(session);
            cancellation.throwIfCancelled();
        }
        return session;
    }
    catch (error) {
        if (cancellation.isCancelled() && !session) {
            disposeSessionWhenCreated(sessionTask);
        }
        throw error;
    }
}
async function promptWithCancellation(session, prompt, cancellation) {
    if (cancellation.isCancelled()) {
        requestSessionAbort(session);
        cancellation.throwIfCancelled();
    }
    const promptTask = session.prompt(prompt, { expandPromptTemplates: false });
    try {
        await Promise.race([promptTask, cancellation.promise]);
    }
    catch (error) {
        if (cancellation.isCancelled()) {
            requestSessionAbort(session);
        }
        throw error;
    }
    if (cancellation.isCancelled()) {
        requestSessionAbort(session);
        cancellation.throwIfCancelled();
    }
}
function assertGenerationAvailable(ctx, options) {
    if (!ctx.model && !options.createSession) {
        throw new Error("No model selected");
    }
    const signal = options.signal ?? ctx.signal;
    if (signal?.aborted) {
        throw generationAbortError();
    }
}
function loadGenerationDiff(pi, ctx, options, signal) {
    return options.loadStagedDiff ? options.loadStagedDiff(signal) : stagedDiffForCommitMessage(pi, ctx.cwd, signal);
}
function generatedMessageFromSession(session) {
    const response = lastAssistantTextMessage(session.messages);
    if (!response) {
        throw new Error("Background session did not return an assistant message");
    }
    const message = cleanGeneratedCommitMessage(textFromAssistantMessage(response));
    if (message) {
        return message;
    }
    const contentTypes = response.content.map((part) => part.type).join(", ") || "none";
    const reason = response.errorMessage ?? `stop reason: ${response.stopReason}; content: ${contentTypes}`;
    throw new Error(`Model returned an empty commit message (${reason})`);
}
export async function generateCommitMessage(pi, ctx, options = {}) {
    assertGenerationAvailable(ctx, options);
    const signal = options.signal ?? ctx.signal;
    const cancellation = createGenerationCancellation(signal, options.timeoutMs ?? COMMIT_MESSAGE_TIMEOUT_MS);
    let session;
    try {
        const diff = await Promise.race([loadGenerationDiff(pi, ctx, options, signal), cancellation.promise]);
        const createSession = options.createSession ?? (() => defaultSession(pi, ctx));
        session = await createSessionWithCancellation(createSession, cancellation);
        await promptWithCancellation(session, commitMessagePrompt(diff), cancellation);
        return generatedMessageFromSession(session);
    }
    finally {
        cancellation.dispose();
        if (session) {
            disposeSession(session);
        }
    }
}
export async function runGitCommit(pi, cwd, message, signal, amend = false) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        throw new Error("Not a git repository");
    }
    if (!amend) {
        const stagedResult = await runGit(pi, root, ["diff", "--cached", "--quiet", "--"], {
            signal,
            acceptedExitCodes: [0, 1],
        });
        if (stagedResult.code === 0)
            throw new Error("No staged changes to commit");
    }
    const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    const result = await runGit(pi, root, args, { signal, timeoutClass: "mutation" });
    return compactGitOutput(result) || "Commit complete";
}
//# sourceMappingURL=commit-message-service.js.map