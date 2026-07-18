import assert from "node:assert/strict"
import { test } from "node:test"
import { type RefreshIntent, ViewerOperationCoordinator } from "../src/viewer-operation-coordinator.js"
import { deferred, flushPromises } from "./helpers/deferred.js"

interface ContextState {
  cwd: string
  generation: number
}

function coordinatorFor(context: ContextState): ViewerOperationCoordinator {
  return new ViewerOperationCoordinator({ currentContext: () => ({ ...context }) })
}

function refreshIntent(
  context: ContextState,
  run: RefreshIntent<string>["run"],
  apply?: RefreshIntent<string>["apply"],
): RefreshIntent<string> {
  return {
    label: "diff refresh",
    run,
    apply:
      apply ??
      (() => {
        context.generation += 1
      }),
  }
}

test("mutation success remains truthful when its refresh fails", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  let mutationCalls = 0
  let refreshCalls = 0

  const outcome = await coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => {
      mutationCalls += 1
      return "Commit complete"
    },
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      throw new Error("snapshot unavailable")
    }),
  })

  assert.equal(outcome.kind, "refreshFailed")
  assert.equal(mutationCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(coordinator.snapshot.state, "refreshFailed")
  assert.equal(coordinator.snapshot.successMessage, "Commit complete")
  assert.equal(coordinator.snapshot.summary, "Action succeeded; diff refresh failed.")
  assert.equal(coordinator.snapshot.canRetryRefresh, true)
})

test("refresh retry never reruns the preceding mutation", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  let mutationCalls = 0
  let refreshCalls = 0
  let applied = 0
  const intent = refreshIntent(
    context,
    async () => {
      refreshCalls += 1
      if (refreshCalls === 1) {
        throw new Error("temporary refresh failure")
      }
      return "fresh document"
    },
    () => {
      applied += 1
      context.generation += 1
    },
  )

  await coordinator.runMutation({
    label: "branch switch",
    runningMessage: "Switching…",
    mutate: async () => {
      mutationCalls += 1
      return "Switched to feature"
    },
    successMessage: (message) => message,
    refresh: intent,
  })
  const retry = await coordinator.retryRefresh()

  assert.equal(retry.kind, "succeeded")
  assert.equal(mutationCalls, 1)
  assert.equal(refreshCalls, 2)
  assert.equal(applied, 1)
  assert.equal(coordinator.snapshot.state, "succeeded")
  assert.equal(coordinator.snapshot.successMessage, "Switched to feature")
})

test("refresh retry is discarded if its originating document context changed", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  let applied = false
  await coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Committed",
    successMessage: (message) => message,
    refresh: refreshIntent(
      context,
      async () => {
        throw new Error("refresh failed")
      },
      () => {
        applied = true
      },
    ),
  })
  context.cwd = "/repo-b"
  context.generation += 1

  const retry = await coordinator.retryRefresh()

  assert.equal(retry.kind, "stale")
  assert.equal(applied, false)
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("mutation failure does not refresh by default", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  let refreshCalls = 0

  const outcome = await coordinator.runMutation({
    label: "discard",
    runningMessage: "Discarding…",
    mutate: async () => {
      throw new Error("discard rejected")
    },
    successMessage: () => "Discarded",
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      return "document"
    }),
  })

  assert.equal(outcome.kind, "mutationFailed")
  assert.equal(refreshCalls, 0)
  assert.equal(coordinator.snapshot.state, "failed")
  assert.equal(coordinator.snapshot.failure?.summary, "discard rejected")
})

test("a rejected mutation cannot publish failure after its context becomes stale", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  const outcomePromise = coordinator.runMutation({
    label: "branch switch",
    runningMessage: "Switching…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => "current document"),
  })

  context.cwd = "/repo-b"
  context.generation += 1
  mutation.reject(new Error("obsolete branch failure"))
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(coordinator.snapshot.state, "idle")
  assert.equal(coordinator.snapshot.failure, undefined)
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("a rejected post-mutation refresh cannot install stale recovery", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const refresh = deferred<string>()
  const outcomePromise = coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Commit complete",
    successMessage: (message) => message,
    refresh: refreshIntent(context, () => refresh.promise),
  })
  await flushPromises()

  context.cwd = "/repo-b"
  context.generation += 1
  refresh.reject(new Error("obsolete refresh failure"))
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(coordinator.snapshot.state, "idle")
  assert.equal(coordinator.snapshot.failure, undefined)
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("repeated and concurrent mutations are rejected", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  let mutationCalls = 0
  const spec = {
    label: "stage",
    runningMessage: "Staging…",
    mutate: () => {
      mutationCalls += 1
      return mutation.promise
    },
    successMessage: (message: string) => message,
    refresh: refreshIntent(context, async () => "current document"),
  }

  const first = coordinator.runMutation(spec)
  const second = await coordinator.runMutation(spec)

  assert.deepEqual(second, { kind: "rejected", reason: "busy" })
  assert.equal(mutationCalls, 1)
  mutation.resolve("Staged")
  assert.equal((await first).kind, "succeeded")
})

test("a load cannot apply after its document generation becomes stale", async () => {
  const context = { cwd: "/repo", generation: 7 }
  const coordinator = coordinatorFor(context)
  const load = deferred<string>()
  let applied = false
  const outcomePromise = coordinator.runLoad({
    label: "working tree",
    runningMessage: "Loading…",
    load: () => load.promise,
    apply: () => {
      applied = true
    },
  })

  context.generation += 1
  load.resolve("old document")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(applied, false)
})

test("a rejected load cannot publish failure after its generation becomes stale", async () => {
  const context = { cwd: "/repo", generation: 3 }
  const coordinator = coordinatorFor(context)
  const load = deferred<string>()
  const outcomePromise = coordinator.runLoad({
    label: "working tree",
    runningMessage: "Loading…",
    load: () => load.promise,
    apply: () => assert.fail("a rejected load must not apply"),
  })

  context.generation += 1
  load.reject(new Error("obsolete snapshot failure"))
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(coordinator.snapshot.state, "idle")
  assert.equal(coordinator.snapshot.failure, undefined)
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("a worktree/context change invalidates an older load completion", async () => {
  const context = { cwd: "/repo-a", generation: 1 }
  const coordinator = coordinatorFor(context)
  const load = deferred<string>()
  let appliedCwd = ""
  const outcomePromise = coordinator.runLoad({
    label: "worktree",
    runningMessage: "Loading worktree…",
    load: () => load.promise,
    apply: () => {
      appliedCwd = "/repo-b"
    },
  })

  context.cwd = "/repo-c"
  context.generation += 1
  load.resolve("repo-b document")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(appliedCwd, "")
})

test("loads and mutations serialize in both directions", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const load = deferred<string>()
  const loadOutcome = coordinator.runLoad({
    label: "commits",
    runningMessage: "Loading commits…",
    load: () => load.promise,
    apply: () => {},
  })

  assert.deepEqual(
    await coordinator.runMutation({
      label: "stage",
      runningMessage: "Staging…",
      mutate: async () => "Staged",
      successMessage: (message) => message,
      refresh: refreshIntent(context, async () => "current document"),
    }),
    { kind: "rejected", reason: "busy" },
  )
  load.resolve("commits")
  assert.equal((await loadOutcome).kind, "succeeded")

  const mutation = deferred<string>()
  const mutationOutcome = coordinator.runMutation({
    label: "stage",
    runningMessage: "Staging…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => "current document"),
  })
  assert.deepEqual(
    await coordinator.runLoad({
      label: "branches",
      runningMessage: "Loading branches…",
      load: async () => [],
      apply: () => {},
    }),
    { kind: "rejected", reason: "busy" },
  )
  mutation.resolve("Staged")
  assert.equal((await mutationOutcome).kind, "succeeded")
})

test("a fulfilled mutation becomes stale before starting its refresh", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  let refreshCalls = 0
  const outcomePromise = coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      return "current document"
    }),
  })

  context.cwd = "/repo-b"
  context.generation += 1
  mutation.resolve("Commit complete")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(refreshCalls, 0)
  assert.equal(coordinator.snapshot.state, "idle")
})

test("a fulfilled post-mutation refresh cannot apply after becoming stale", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const refresh = deferred<string>()
  let applied = false
  const outcomePromise = coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Commit complete",
    successMessage: (message) => message,
    refresh: refreshIntent(
      context,
      () => refresh.promise,
      () => {
        applied = true
      },
    ),
  })
  await flushPromises()

  context.cwd = "/repo-b"
  context.generation += 1
  refresh.resolve("obsolete document")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(applied, false)
  assert.equal(coordinator.snapshot.state, "idle")
})

test("cancelling during post-mutation refresh always starts a new reconciliation", async (t) => {
  for (const completion of ["resolve", "reject"] as const) {
    await t.test(completion, async () => {
      const context = { cwd: "/repo", generation: 0 }
      const coordinator = coordinatorFor(context)
      const firstRefresh = deferred<string>()
      const reconciliation = deferred<string>()
      const signals: AbortSignal[] = []
      let refreshCalls = 0
      let applied = 0
      const outcomePromise = coordinator.runMutation({
        label: "pull",
        runningMessage: "Pulling…",
        mutate: async () => "Pull complete",
        successMessage: (message) => message,
        refresh: refreshIntent(
          context,
          ({ signal }) => {
            signals.push(signal)
            refreshCalls += 1
            return refreshCalls === 1 ? firstRefresh.promise : reconciliation.promise
          },
          () => {
            applied += 1
            context.generation += 1
          },
        ),
      })
      await flushPromises()

      assert.equal(coordinator.cancelActive(), true)
      assert.equal(signals[0]?.aborted, true)
      if (completion === "resolve") {
        firstRefresh.resolve("obsolete document")
      } else {
        firstRefresh.reject(new DOMException("cancelled", "AbortError"))
      }
      await flushPromises()
      assert.equal(coordinator.snapshot.state, "reconciling")
      assert.equal(signals[1]?.aborted, false)
      reconciliation.resolve("current document")
      const outcome = await outcomePromise

      assert.equal(outcome.kind, "cancelled")
      assert.equal(outcome.reconciled, true)
      assert.equal(refreshCalls, 2)
      assert.equal(applied, 1)
    })
  }
})

test("an aborted mutation rejection still performs mandatory reconciliation", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  const reconciliation = deferred<string>()
  let mutationSignal: AbortSignal | undefined
  const outcomePromise = coordinator.runMutation({
    label: "stash",
    runningMessage: "Stashing…",
    mutate: ({ signal }) => {
      mutationSignal = signal
      return mutation.promise
    },
    successMessage: (message) => message,
    refresh: refreshIntent(context, () => reconciliation.promise),
  })

  coordinator.cancelActive()
  assert.equal(mutationSignal?.aborted, true)
  mutation.reject(new DOMException("cancelled", "AbortError"))
  await flushPromises()
  assert.equal(coordinator.snapshot.state, "reconciling")
  reconciliation.resolve("current document")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "cancelled")
  assert.equal(outcome.reconciled, true)
})

test("cancelling a mutation reconciles before another mutation can start", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  const reconciliation = deferred<string>()
  const states: string[] = []
  const observed = new ViewerOperationCoordinator({
    currentContext: () => ({ ...context }),
    onChange: (snapshot) => states.push(snapshot.state),
  })
  const outcomePromise = observed.runMutation({
    label: "pull",
    runningMessage: "Pulling…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(context, () => reconciliation.promise),
  })

  assert.equal(observed.cancelActive(), true)
  assert.equal(observed.snapshot.state, "cancelling")
  mutation.resolve("Pull complete")
  await flushPromises()
  assert.equal(observed.snapshot.state, "reconciling")
  assert.deepEqual(
    await observed.runMutation({
      label: "stage",
      runningMessage: "Staging…",
      mutate: async () => "Staged",
      successMessage: (message) => message,
      refresh: refreshIntent(context, async () => "current document"),
    }),
    { kind: "rejected", reason: "busy" },
  )

  reconciliation.resolve("current document")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "cancelled")
  assert.equal(outcome.reconciled, true)
  assert.ok(states.includes("cancelling"))
  assert.ok(states.includes("reconciling"))
  assert.equal(observed.snapshot.state, "succeeded")
  assert.equal(coordinator.snapshot.state, "idle")
})

test("failed cancellation reconciliation blocks mutations until refresh retry succeeds", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  let refreshCalls = 0
  const mutation = deferred<string>()
  const outcomePromise = coordinator.runMutation({
    label: "stash",
    runningMessage: "Stashing…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      if (refreshCalls === 1) {
        throw new Error("reconciliation failed")
      }
      return "fresh document"
    }),
  })

  coordinator.cancelActive()
  mutation.resolve("Stashed")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "cancelled")
  assert.equal(outcome.reconciled, false)
  assert.equal(coordinator.snapshot.state, "refreshFailed")
  assert.deepEqual(
    await coordinator.runMutation({
      label: "stage",
      runningMessage: "Staging…",
      mutate: async () => "Staged",
      successMessage: (message) => message,
      refresh: refreshIntent(context, async () => "current document"),
    }),
    { kind: "rejected", reason: "refreshRequired" },
  )
  assert.equal((await coordinator.retryRefresh()).kind, "succeeded")
  assert.equal(refreshCalls, 2)
})

test("stale reconciliation rejections are ignored", async (t) => {
  for (const reconcileOnFailure of [false, true]) {
    await t.test(reconcileOnFailure ? "failed mutation" : "cancellation", async () => {
      const context = { cwd: "/repo-a", generation: 0 }
      const coordinator = coordinatorFor(context)
      const mutation = deferred<string>()
      const reconciliation = deferred<string>()
      const outcomePromise = coordinator.runMutation({
        label: "pull",
        runningMessage: "Pulling…",
        mutate: () => mutation.promise,
        successMessage: (message) => message,
        refresh: refreshIntent(context, () => reconciliation.promise),
        reconcileOnFailure,
      })

      if (reconcileOnFailure) {
        mutation.reject(new Error("pull failed after partial changes"))
      } else {
        coordinator.cancelActive()
        mutation.resolve("Pull complete")
      }
      await flushPromises()
      assert.equal(coordinator.snapshot.state, "reconciling")
      context.cwd = "/repo-b"
      context.generation += 1
      reconciliation.reject(new Error("obsolete reconciliation failure"))
      const outcome = await outcomePromise

      assert.equal(outcome.kind, "stale")
      assert.equal(coordinator.snapshot.state, "idle")
      assert.equal(coordinator.snapshot.failure, undefined)
      assert.equal(coordinator.snapshot.canRetryRefresh, false)
    })
  }
})

test("a fulfilled cancellation reconciliation cannot apply after becoming stale", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const mutation = deferred<string>()
  const reconciliation = deferred<string>()
  let applied = false
  const outcomePromise = coordinator.runMutation({
    label: "pull",
    runningMessage: "Pulling…",
    mutate: () => mutation.promise,
    successMessage: (message) => message,
    refresh: refreshIntent(
      context,
      () => reconciliation.promise,
      () => {
        applied = true
      },
    ),
  })

  coordinator.cancelActive()
  mutation.resolve("Pull complete")
  await flushPromises()
  context.cwd = "/repo-b"
  context.generation += 1
  reconciliation.resolve("obsolete reconciliation")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "stale")
  assert.equal(applied, false)
  assert.equal(coordinator.snapshot.state, "idle")
})

// fallow-ignore-next-line complexity
test("failed mutation reconciliation retains the mutation error across refresh-only retry", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  let mutationCalls = 0
  let refreshCalls = 0
  const outcome = await coordinator.runMutation({
    label: "pull",
    runningMessage: "Pulling…",
    mutate: async () => {
      mutationCalls += 1
      throw new Error("pull failed after updating files")
    },
    successMessage: () => "Pull complete",
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      if (refreshCalls === 1) {
        throw new Error("snapshot failed during reconciliation")
      }
      if (refreshCalls === 2) {
        throw new Error("snapshot failed again during retry")
      }
      return "current document"
    }),
    reconcileOnFailure: true,
  })

  assert.equal(outcome.kind, "refreshFailed")
  assert.equal(coordinator.snapshot.state, "refreshFailed")
  assert.match(coordinator.snapshot.failure?.details ?? "", /pull failed after updating files/u)
  assert.match(coordinator.snapshot.failure?.details ?? "", /snapshot failed during reconciliation/u)

  const failedRetry = await coordinator.retryRefresh()

  assert.equal(failedRetry.kind, "failed")
  assert.equal(mutationCalls, 1)
  assert.equal(refreshCalls, 2)
  assert.match(coordinator.snapshot.failure?.details ?? "", /pull failed after updating files/u)
  assert.match(coordinator.snapshot.failure?.details ?? "", /snapshot failed during reconciliation/u)
  assert.match(coordinator.snapshot.failure?.details ?? "", /snapshot failed again during retry/u)

  const recoveredRetry = await coordinator.retryRefresh()

  assert.equal(recoveredRetry.kind, "succeeded")
  assert.equal(mutationCalls, 1)
  assert.equal(refreshCalls, 3)
  assert.equal(coordinator.snapshot.state, "failed")
  assert.equal(coordinator.snapshot.failure?.summary, "pull failed after updating files")
})

test("a rejected stale refresh retry clears recovery without publishing failure", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const retryRefresh = deferred<string>()
  let refreshCalls = 0
  await coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Commit complete",
    successMessage: (message) => message,
    refresh: refreshIntent(context, async () => {
      refreshCalls += 1
      if (refreshCalls === 1) {
        throw new Error("initial refresh failure")
      }
      return retryRefresh.promise
    }),
  })
  const retryPromise = coordinator.retryRefresh()
  await flushPromises()

  context.cwd = "/repo-b"
  context.generation += 1
  retryRefresh.reject(new Error("obsolete retry failure"))
  const retry = await retryPromise

  assert.equal(retry.kind, "stale")
  assert.equal(coordinator.snapshot.state, "idle")
  assert.equal(coordinator.snapshot.failure, undefined)
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("a fulfilled refresh retry cannot apply after becoming stale", async () => {
  const context = { cwd: "/repo-a", generation: 0 }
  const coordinator = coordinatorFor(context)
  const retryRefresh = deferred<string>()
  let refreshCalls = 0
  let applied = false
  await coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Commit complete",
    successMessage: (message) => message,
    refresh: refreshIntent(
      context,
      async () => {
        refreshCalls += 1
        if (refreshCalls === 1) {
          throw new Error("initial refresh failure")
        }
        return retryRefresh.promise
      },
      () => {
        applied = true
      },
    ),
  })
  const retryPromise = coordinator.retryRefresh()
  await flushPromises()

  context.cwd = "/repo-b"
  context.generation += 1
  retryRefresh.resolve("obsolete retry document")
  const retry = await retryPromise

  assert.equal(retry.kind, "stale")
  assert.equal(applied, false)
  assert.equal(coordinator.snapshot.state, "idle")
  assert.equal(coordinator.snapshot.canRetryRefresh, false)
})

test("cancelling a refresh retry retains the prior failure and retry intent", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const retryRefresh = deferred<string>()
  let retrySignal: AbortSignal | undefined
  let refreshCalls = 0
  await coordinator.runMutation({
    label: "commit",
    runningMessage: "Committing…",
    mutate: async () => "Commit complete",
    successMessage: (message) => message,
    refresh: refreshIntent(context, async ({ signal }) => {
      refreshCalls += 1
      if (refreshCalls === 1) {
        throw new Error("initial refresh failure")
      }
      retrySignal = signal
      return retryRefresh.promise
    }),
  })
  const retryPromise = coordinator.retryRefresh()
  await flushPromises()

  assert.equal(coordinator.cancelActive(), true)
  assert.equal(retrySignal?.aborted, true)
  retryRefresh.reject(new DOMException("cancelled", "AbortError"))
  const retry = await retryPromise

  assert.equal(retry.kind, "cancelled")
  assert.equal(coordinator.snapshot.state, "refreshFailed")
  assert.equal(coordinator.snapshot.failure?.summary, "initial refresh failure")
  assert.equal(coordinator.snapshot.canRetryRefresh, true)
})

test("loads can be cancelled without applying late results", async () => {
  const context = { cwd: "/repo", generation: 0 }
  const coordinator = coordinatorFor(context)
  const load = deferred<string>()
  let applied = false
  const outcomePromise = coordinator.runLoad({
    label: "commits",
    runningMessage: "Loading commits…",
    load: () => load.promise,
    apply: () => {
      applied = true
    },
  })

  assert.equal(coordinator.cancelActive(), true)
  load.resolve("late list")
  const outcome = await outcomePromise

  assert.equal(outcome.kind, "cancelled")
  assert.equal(applied, false)
  assert.equal(coordinator.snapshot.state, "idle")
})
