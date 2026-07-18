import assert from "node:assert/strict"
import { test } from "node:test"
import { ViewerOperationCoordinator, type ViewerOperationEvent } from "../src/viewer-operation-coordinator.js"

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test("mutation bursts accept one operation and reject duplicate or different input", async () => {
  for (const count of [2, 10, 50]) {
    const events: ViewerOperationEvent[] = []
    const coordinator = new ViewerOperationCoordinator({ onEvent: (event) => events.push(event) })
    const gate = deferred<void>()
    let active = 0
    let peak = 0
    let taskCalls = 0
    const runs = Array.from({ length: count }, (_, index) =>
      coordinator.runMutation(index === count - 1 ? "stage-all" : "stage-file", async () => {
        taskCalls++
        active++
        peak = Math.max(peak, active)
        await gate.promise
        active--
        return "done"
      }),
    )

    assert.equal(coordinator.mutationActive, true)
    assert.equal(taskCalls, 1)
    gate.resolve()
    const results = await Promise.all(runs)

    assert.equal(results.filter((result) => result.accepted).length, 1)
    assert.equal(events.filter((event) => event.type === "mutation-rejected").length, count - 1)
    assert.equal(events.filter((event) => event.type === "mutation-started").length, 1)
    assert.equal(events.filter((event) => event.type === "mutation-finished").length, 1)
    assert.equal(peak, 1)
    assert.equal(coordinator.mutationActive, false)
  }
})

test("only the newest load may apply, even when the older load resolves last", async () => {
  const events: ViewerOperationEvent[] = []
  const coordinator = new ViewerOperationCoordinator({ onEvent: (event) => events.push(event) })
  const older = deferred<string>()
  const applied: string[] = []

  const olderRun = coordinator.applyLatest(
    "worktree:A",
    () => older.promise,
    (value) => applied.push(value),
  )
  const newerRun = coordinator.applyLatest(
    "worktree:B",
    async () => "B",
    (value) => applied.push(value),
  )

  assert.equal(await newerRun, "applied")
  older.resolve("A")
  assert.equal(await olderRun, "superseded")
  assert.deepEqual(applied, ["B"])
  assert.deepEqual(
    events.filter((event) => event.type.startsWith("load-")).map((event) => event.type),
    ["load-started", "load-started", "load-applied", "load-superseded"],
  )
})

test("a stale load rejection is suppressed after a newer load applies", async () => {
  const coordinator = new ViewerOperationCoordinator()
  const older = deferred<string>()
  const olderRun = coordinator.applyLatest(
    "older",
    () => older.promise,
    () => {
      throw new Error("older result must not apply")
    },
  )

  assert.equal(
    await coordinator.applyLatest(
      "newer",
      async () => "new",
      () => {},
    ),
    "applied",
  )
  older.reject(new Error("stale failure"))
  assert.equal(await olderRun, "superseded")
})

test("starting a mutation aborts an older read before accepting its owned refresh", async () => {
  const coordinator = new ViewerOperationCoordinator()
  let readSignal: AbortSignal | undefined
  const read = coordinator.applyLatest(
    "commit-message",
    (signal) => {
      readSignal = signal
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("read aborted")), { once: true })
      })
    },
    () => {
      throw new Error("aborted read must not apply")
    },
  )
  const gate = deferred<void>()
  const mutation = coordinator.runMutation("commit", async () => gate.promise)

  assert.equal(readSignal?.aborted, true)
  assert.equal(await read, "superseded")
  gate.resolve()
  assert.equal((await mutation).accepted, true)
})

test("a mutation owns its refresh and unrelated loads are rejected", async () => {
  const coordinator = new ViewerOperationCoordinator()
  const mutationGate = deferred<void>()
  let mutationSignal: AbortSignal | undefined
  const mutation = coordinator.runMutation("commit", async (signal) => {
    mutationSignal = signal
    await mutationGate.promise
  })
  assert.ok(mutationSignal)

  let unrelatedLoads = 0
  assert.equal(
    await coordinator.applyLatest(
      "unrelated",
      async () => {
        unrelatedLoads++
        return "wrong"
      },
      () => {},
    ),
    "superseded",
  )
  assert.equal(unrelatedLoads, 0)

  let applied = ""
  assert.equal(
    await coordinator.applyLatest(
      "mutation-refresh",
      async () => "current",
      (value) => (applied = value),
      mutationSignal,
    ),
    "applied",
  )
  assert.equal(applied, "current")
  mutationGate.resolve()
  assert.equal((await mutation).accepted, true)
})

test("disposing aborts active work and prevents later document application", async () => {
  const parent = new AbortController()
  const coordinator = new ViewerOperationCoordinator({ signal: parent.signal })
  let loadSignal: AbortSignal | undefined
  let applied = false
  const load = coordinator.applyLatest(
    "closing",
    (signal) => {
      loadSignal = signal
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    },
    () => {
      applied = true
    },
  )

  parent.abort()

  assert.equal(loadSignal?.aborted, true)
  assert.equal(await load, "superseded")
  assert.equal(applied, false)
  assert.equal(
    await coordinator.applyLatest(
      "after-close",
      async () => "late",
      () => {},
    ),
    "superseded",
  )
})
