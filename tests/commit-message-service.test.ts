import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { createBackgroundSessionManager, generateCommitMessage } from "../src/commit-message-service.js"
import { deferred, flushPromises } from "./helpers/deferred.js"

interface FakeSession {
  abort: () => Promise<void>
  dispose: () => void
  messages: unknown[]
  prompt: () => Promise<void>
}

function context(): ExtensionContext {
  return { cwd: "/repo" } as ExtensionContext
}

function pi(): ExtensionAPI {
  return {} as ExtensionAPI
}

function assistantMessage(text: string): unknown {
  return { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
}

interface FakeSessionOptions {
  abort?: () => Promise<void>
  dispose?: () => void
  messages?: unknown[]
  prompt?: () => Promise<void>
}

function trackedSession(events: string[], options: FakeSessionOptions = {}): FakeSession {
  return {
    abort:
      options.abort ??
      (async () => {
        events.push("abort")
      }),
    dispose: options.dispose ?? (() => events.push("dispose")),
    messages: options.messages ?? [],
    prompt:
      options.prompt ??
      (async () => {
        events.push("prompt")
      }),
  }
}

test("background session creation tolerates an active leaf missing from the persisted session", async () => {
  const sessionDirectory = await mkdtemp(join(tmpdir(), "pi-git-stale-session-"))
  const sessionFile = join(sessionDirectory, "active.jsonl")
  const header = {
    type: "session",
    version: 3,
    id: "active-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/repo",
  }
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`)

  const staleContext = {
    cwd: "/repo",
    sessionManager: {
      getLeafId: () => "a9ef319d",
      getSessionDir: () => sessionDirectory,
      getSessionFile: () => sessionFile,
    },
  } as unknown as ExtensionContext

  try {
    const sessionManager = createBackgroundSessionManager(staleContext)
    assert.equal(sessionManager.isPersisted(), false)
    assert.equal(sessionManager.getCwd(), "/repo")
  } finally {
    await rm(sessionDirectory, { recursive: true, force: true })
  }
})

function pendingSessionGeneration(controller: AbortController) {
  const sessionTask = deferred<FakeSession>()
  const events: string[] = []
  const session = trackedSession(events, { messages: [assistantMessage("fix: too late")] })
  const generated = generateCommitMessage(pi(), context(), {
    signal: controller.signal,
    timeoutMs: 10_000,
    loadStagedDiff: async () => "diff",
    createSession: () => sessionTask.promise as never,
  })
  return { events, generated, session, sessionTask }
}

test("an already-aborted generation never loads, creates, or prompts", async () => {
  const controller = new AbortController()
  controller.abort()
  let diffCalls = 0
  let createCalls = 0
  let promptCalls = 0

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        signal: controller.signal,
        loadStagedDiff: async () => {
          diffCalls += 1
          return "diff"
        },
        createSession: async () => {
          createCalls += 1
          return {
            abort: async () => {},
            dispose: () => {},
            messages: [],
            prompt: async () => {
              promptCalls += 1
            },
          } as never
        },
      }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  )

  assert.deepEqual({ diffCalls, createCalls, promptCalls }, { diffCalls: 0, createCalls: 0, promptCalls: 0 })
})

test("generated commit message prompting times out, aborts, then disposes", async () => {
  const prompt = deferred<void>()
  const events: string[] = []
  const session = trackedSession(events, { prompt: () => prompt.promise })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        timeoutMs: 5,
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    /timed out/iu,
  )

  assert.deepEqual(events, ["abort", "dispose"])
  prompt.resolve()
})

test("timeout rejects and disposes even when session abort never settles", async () => {
  const prompt = deferred<void>()
  const abort = deferred<void>()
  const events: string[] = []
  const session = trackedSession(events, {
    abort: () => {
      events.push("abort")
      return abort.promise
    },
    prompt: () => prompt.promise,
  })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        timeoutMs: 5,
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    /timed out/iu,
  )

  assert.deepEqual(events, ["abort", "dispose"])
  abort.resolve()
  prompt.resolve()
})

test("abort signal cancels generation, aborts the session, and disposes it", async () => {
  const prompt = deferred<void>()
  const promptStarted = deferred<void>()
  const controller = new AbortController()
  const events: string[] = []
  const session = trackedSession(events, {
    prompt: () => {
      promptStarted.resolve()
      return prompt.promise
    },
  })
  const generated = generateCommitMessage(pi(), context(), {
    signal: controller.signal,
    timeoutMs: 10_000,
    loadStagedDiff: async () => "diff",
    createSession: async () => session as never,
  })
  await promptStarted.promise

  controller.abort()

  await assert.rejects(generated, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
  assert.deepEqual(events, ["abort", "dispose"])
  prompt.resolve()
})

test("abort while session creation is pending rejects promptly and disposes the late session", async () => {
  const controller = new AbortController()
  const { events, generated, session, sessionTask } = pendingSessionGeneration(controller)
  await flushPromises()

  controller.abort()
  await assert.rejects(generated, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
  sessionTask.resolve(session)
  await flushPromises()

  assert.deepEqual(events, ["abort", "dispose"])
})

test("a session-creation cancellation tie aborts and disposes without prompting", async () => {
  const controller = new AbortController()
  const { events, generated, session, sessionTask } = pendingSessionGeneration(controller)
  await flushPromises()

  sessionTask.resolve(session)
  controller.abort()
  await assert.rejects(generated, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
  await flushPromises()

  assert.deepEqual(events, ["abort", "dispose"])
})

test("timeout while session creation is pending aborts and disposes the late session", async () => {
  const sessionTask = deferred<FakeSession>()
  const events: string[] = []
  const session = trackedSession(events, { messages: [assistantMessage("fix: too late")] })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        timeoutMs: 5,
        loadStagedDiff: async () => "diff",
        createSession: () => sessionTask.promise as never,
      }),
    /timed out/iu,
  )
  sessionTask.resolve(session)
  await flushPromises()

  assert.deepEqual(events, ["abort", "dispose"])
})

test("prompt completion cannot beat a cancellation requested in the same turn", async () => {
  const controller = new AbortController()
  const events: string[] = []
  const session = trackedSession(events, {
    messages: [assistantMessage("fix: should not escape cancellation")],
    prompt: async () => {
      controller.abort()
    },
  })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        signal: controller.signal,
        timeoutMs: 10_000,
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  )

  assert.deepEqual(events, ["abort", "dispose"])
})

test("prompt rejection preserves the original error and disposes once", async () => {
  const promptFailure = new Error("provider prompt failed")
  const events: string[] = []
  const session = trackedSession(events, {
    prompt: async () => {
      throw promptFailure
    },
  })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    (error: unknown) => error === promptFailure,
  )
  assert.deepEqual(events, ["dispose"])
})

test("missing assistant response disposes once", async () => {
  const events: string[] = []
  const session = trackedSession(events)

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    /did not return an assistant message/u,
  )
  assert.deepEqual(events, ["prompt", "dispose"])
})

test("empty assistant response disposes once", async () => {
  const events: string[] = []
  const session = trackedSession(events, { messages: [assistantMessage("   ")] })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    /empty commit message/u,
  )
  assert.deepEqual(events, ["prompt", "dispose"])
})

test("disposal failure cannot mask a prompt failure", async () => {
  const promptFailure = new Error("provider prompt failed")
  const session = trackedSession([], {
    dispose: () => {
      throw new Error("dispose failed")
    },
    prompt: async () => {
      throw promptFailure
    },
  })

  await assert.rejects(
    () =>
      generateCommitMessage(pi(), context(), {
        loadStagedDiff: async () => "diff",
        createSession: async () => session as never,
      }),
    (error: unknown) => error === promptFailure,
  )
})

test("disposal failure cannot replace a generated message", async () => {
  const session = trackedSession([], {
    dispose: () => {
      throw new Error("dispose failed")
    },
    messages: [assistantMessage("fix: keep generated message")],
  })

  const message = await generateCommitMessage(pi(), context(), {
    loadStagedDiff: async () => "diff",
    createSession: async () => session as never,
  })

  assert.equal(message, "fix: keep generated message")
})

test("successful generation returns the first cleaned assistant line", async () => {
  const events: string[] = []
  const session = trackedSession(events, {
    messages: [assistantMessage('Commit message: "fix: retain refresh success"\nignored')],
    prompt: async () => {},
  })

  const message = await generateCommitMessage(pi(), context(), {
    loadStagedDiff: async () => "diff",
    createSession: async () => session as never,
  })

  assert.equal(message, "fix: retain refresh success")
  assert.deepEqual(events, ["dispose"])
})
