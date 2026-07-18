import assert from "node:assert/strict"
import { test } from "node:test"
import { promptAgentWithAbort } from "../src/commit-message-service.js"
import { GitAbortError } from "../src/git-service.js"

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

class PreflightSession {
  readonly allowAgentStart = deferred<void>()
  readonly activeAbort = deferred<void>()
  readonly listeners = new Set<(event: { type: "agent_start" }) => void>()
  promptCalls = 0
  abortCalls = 0
  active = false

  async prompt(): Promise<void> {
    this.promptCalls++
    await this.allowAgentStart.promise
    this.active = true
    for (const listener of this.listeners) listener({ type: "agent_start" })
    await this.activeAbort.promise
    this.active = false
  }

  async abort(): Promise<void> {
    this.abortCalls++
    if (this.active) this.activeAbort.resolve()
  }

  subscribe(listener: (event: { type: "agent_start" }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

test("commit-message cancellation is re-applied when an agent starts after preflight", async () => {
  const session = new PreflightSession()
  const controller = new AbortController()
  const run = promptAgentWithAbort(
    session as unknown as Parameters<typeof promptAgentWithAbort>[0],
    "prompt",
    controller.signal,
  )

  assert.equal(session.promptCalls, 1)
  controller.abort()
  assert.equal(session.abortCalls, 1)
  session.allowAgentStart.resolve()

  await assert.rejects(run, GitAbortError)
  assert.equal(session.abortCalls, 2)
  assert.equal(session.listeners.size, 0)
})

test("a pre-aborted commit-message prompt never starts a session turn", async () => {
  const session = new PreflightSession()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    () =>
      promptAgentWithAbort(
        session as unknown as Parameters<typeof promptAgentWithAbort>[0],
        "prompt",
        controller.signal,
      ),
    GitAbortError,
  )
  assert.equal(session.promptCalls, 0)
  assert.equal(session.abortCalls, 0)
  assert.equal(session.listeners.size, 0)
})
