import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  assertGitSuccess,
  ensureGitRepository,
  GIT_TIMEOUTS,
  GitAbortError,
  GitExitError,
  GitKilledError,
  GitTimeoutError,
  probeGit,
  runGit,
} from "../src/git-service.js"
import { createTempGitRepository, createTrackingGitPi } from "./helpers/temp-git-repository.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }
type RawGitResult = { stdout: string; stderr: string; code: number; killed: boolean }

function result(overrides: Partial<RawGitResult> = {}): RawGitResult {
  return { stdout: "", stderr: "", code: 0, killed: false, ...overrides }
}

function fakePi(handler: (args: string[], options?: ExecOptions) => RawGitResult | Promise<RawGitResult>): {
  pi: ExtensionAPI
  calls: Array<{ args: string[]; options?: ExecOptions }>
} {
  const calls: Array<{ args: string[]; options?: ExecOptions }> = []
  const pi = {
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      assert.equal(command, "git")
      calls.push({ args, options })
      return handler(args, options)
    },
  } as unknown as ExtensionAPI
  return { pi, calls }
}

test("pre-aborted Git work is rejected before spawning", async () => {
  const controller = new AbortController()
  controller.abort()
  const { pi, calls } = fakePi(() => result())

  await assert.rejects(
    () => runGit(pi, "/repo", ["fetch"], { signal: controller.signal, timeoutClass: "network" }),
    (error: unknown) =>
      error instanceof GitAbortError && error instanceof GitKilledError && error.timeoutClass === "network",
  )
  assert.equal(calls.length, 0)
})

test("a killed command maps to abort when its signal is aborted and discards output", async () => {
  const controller = new AbortController()
  const { pi } = fakePi(() => {
    controller.abort()
    return result({ stdout: "partial output", code: 0, killed: true })
  })

  await assert.rejects(
    () => runGit(pi, "/repo", ["diff"], { signal: controller.signal }),
    (error: unknown) => error instanceof GitAbortError && !("result" in error),
  )
})

test("a killed command without cancellation maps to a typed timeout", async () => {
  const { pi } = fakePi(() => result({ stdout: "partial output", code: 0, killed: true }))

  await assert.rejects(
    () => runGit(pi, "/repo", ["fetch"], { timeoutClass: "network" }),
    (error: unknown) =>
      error instanceof GitTimeoutError &&
      error instanceof GitKilledError &&
      error.timeoutClass === "network" &&
      error.timeoutMs === GIT_TIMEOUTS.network &&
      !("result" in error),
  )
})

test("cancellation wins when exec resolves a completed-looking result", async () => {
  const controller = new AbortController()
  const { pi } = fakePi(() => {
    controller.abort()
    return result({ stdout: "complete-looking output" })
  })

  await assert.rejects(() => runGit(pi, "/repo", ["diff"], { signal: controller.signal }), GitAbortError)
})

test("local, mutation, and network commands receive centralized timeouts", async () => {
  const { pi, calls } = fakePi(() => result())

  await runGit(pi, "/repo", ["status"])
  await runGit(pi, "/repo", ["commit"], { timeoutClass: "mutation" })
  await runGit(pi, "/repo", ["push"], { timeoutClass: "network" })

  assert.deepEqual(
    calls.map((call) => call.options?.timeout),
    [GIT_TIMEOUTS.local, GIT_TIMEOUTS.mutation, GIT_TIMEOUTS.network],
  )
})

test("a real Git child is terminated at the configured wall-clock timeout", async () => {
  const repo = await createTempGitRepository()
  try {
    const tracker = createTrackingGitPi()
    const started = performance.now()

    await assert.rejects(
      () => runGit(tracker.pi, repo.path, ["hash-object", "--stdin"], { timeoutMs: 25 }),
      (error: unknown) => error instanceof GitTimeoutError && error.timeoutMs === 25,
    )

    assert.equal(performance.now() - started < 2_000, true)
    assert.equal(tracker.calls.length, 1)
    assert.equal(tracker.calls[0]?.timeout, 25)
  } finally {
    await repo.cleanup()
  }
})

test("ordinary command failures throw GitExitError with completed output", async () => {
  const failed = result({ stdout: "hint", stderr: "fatal: failed", code: 7 })
  const { pi } = fakePi(() => failed)

  await assert.rejects(
    () => runGit(pi, "/repo", ["status"]),
    (error: unknown) =>
      error instanceof GitExitError &&
      error.result.code === 7 &&
      error.result.stdout === "hint" &&
      error.args.join(" ") === "status",
  )
  assert.throws(() => assertGitSuccess(failed, ["status"]), GitExitError)
})

test("accepted nonzero exits and probes preserve semantic Git statuses", async () => {
  const { pi } = fakePi((args) => result({ code: args[0] === "diff" ? 1 : 23 }))

  assert.equal((await runGit(pi, "/repo", ["diff", "--quiet"], { acceptedExitCodes: [0, 1] })).code, 1)
  assert.equal((await probeGit(pi, "/repo", ["worktree", "add"])).code, 23)
})

test("repository probing accepts only Git's not-a-repository exit", async () => {
  const missing = fakePi(() => result({ code: 128, stderr: "fatal: not a git repository" }))
  assert.equal(await ensureGitRepository(missing.pi, "/tmp"), undefined)

  const unsafe = fakePi(() => result({ code: 128, stderr: "fatal: detected dubious ownership" }))
  await assert.rejects(() => ensureGitRepository(unsafe.pi, "/tmp"), GitExitError)

  const emptyFailure = fakePi(() => result({ code: 128 }))
  await assert.rejects(() => ensureGitRepository(emptyFailure.pi, "/tmp"), GitExitError)

  const broken = fakePi(() => result({ code: 2, stderr: "bad invocation" }))
  await assert.rejects(() => ensureGitRepository(broken.pi, "/tmp"), GitExitError)
})

test("an exec rejection after cancellation is normalized to GitAbortError", async () => {
  const controller = new AbortController()
  const { pi } = fakePi(async () => {
    controller.abort()
    throw new Error("executor aborted")
  })

  await assert.rejects(() => runGit(pi, "/repo", ["status"], { signal: controller.signal }), GitAbortError)
})
