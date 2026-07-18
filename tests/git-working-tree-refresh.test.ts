import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import { GitAbortError } from "../src/git-service.js"
import { refreshWorkingTreeDocument, type WorkingTreeRefreshResult } from "../src/git-working-tree-refresh.js"
import { type DiffDocument, GIT_COMMANDS } from "../src/types.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

function context(cwd: string, signal = new AbortController().signal): ExtensionContext {
  return { cwd, signal } as ExtensionContext
}

function assertSnapshotBasedFullRefresh(
  result: WorkingTreeRefreshResult,
  current: DiffDocument,
  fresh: DiffDocument,
  calls: readonly { args: readonly string[] }[],
  reason: "status-changed" | "content-changed",
): void {
  assert.equal(result.reason, reason)
  assert.equal(result.appliedScope, "full")
  assert.notEqual(result.document.files, current.files)
  assert.deepEqual(result.document, fresh)
  assert.equal(calls.filter((call) => call.args[0] === "status").length, 1)
  assert.equal(
    calls.some((call) => call.args.join(" ") === "rev-parse --show-toplevel"),
    false,
  )
}

function historicalDocument(): DiffDocument {
  return {
    mode: "commit",
    title: "Commit abc",
    subtitle: "history",
    raw: "",
    files: [],
    omittedFileCount: 0,
    capturedPatchBytes: 0,
    capturedPatchLines: 0,
    commit: { hash: "abc", message: "history" },
  }
}

test("none and historical refreshes preserve document identity without Git processes", async () => {
  const pi = {
    exec: async () => {
      throw new Error("Git must not run")
    },
  } as unknown as ExtensionAPI
  const current = historicalDocument()

  const none = await refreshWorkingTreeDocument(pi, context("/repo"), current, "none")
  const historical = await refreshWorkingTreeDocument(pi, context("/repo"), current, "full")

  assert.deepEqual(none, { document: current, appliedScope: "none", reason: "none" })
  assert.deepEqual(historical, { document: current, appliedScope: "none", reason: "none" })
  assert.equal(none.document, current)
  assert.equal(historical.document, current)
})

test("an unchanged clean status refresh reuses patch and file identities with one process", async () => {
  const repo = await createTempGitRepository()
  try {
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const tracker = createTrackingGitPi()

    const result = await refreshWorkingTreeDocument(tracker.pi, context(repo.path), current, "status")

    assert.equal(result.reason, "status-unchanged")
    assert.equal(result.appliedScope, "status")
    assert.notEqual(result.document, current)
    assert.equal(result.document.files, current.files)
    assert.equal(result.document.raw, current.raw)
    assert.equal(result.document.subtitle, current.subtitle)
    assert.equal(tracker.calls.length, 1)
    assert.equal(tracker.calls[0]?.args[0], "status")
    assert.equal(tracker.calls[0]?.cwd, repo.path)
  } finally {
    await repo.cleanup()
  }
})

test("status-only refresh updates upstream metadata without rebuilding files", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["branch", "upstream"])
    await runFixtureGit(repo.path, ["branch", "--set-upstream-to=upstream", "main"])
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const remoteCommit = (
      await runFixtureGit(repo.path, ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "remote update"])
    ).trim()
    await runFixtureGit(repo.path, ["branch", "-f", "upstream", remoteCommit])
    const tracker = createTrackingGitPi()

    const result = await refreshWorkingTreeDocument(tracker.pi, context(repo.path), current, "status")

    assert.equal(result.reason, "status-unchanged")
    assert.equal(result.document.subtitle, `${repo.path} (main ↓1)`)
    assert.equal(result.document.files, current.files)
    assert.equal(tracker.calls.length, 1)
    assert.equal(tracker.calls[0]?.args[0], "status")
  } finally {
    await repo.cleanup()
  }
})

test("tracked and untracked changes from a clean baseline escalate status refresh to full", async () => {
  const repo = await createTempGitRepository()
  try {
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    await writeRepoFile(repo.path, "tracked.txt", "changed by hook\n")
    await writeRepoFile(repo.path, "hook-created.txt", "untracked hook output\n")
    const tracker = createTrackingGitPi()

    const result = await refreshWorkingTreeDocument(tracker.pi, context(repo.path), current, "status")
    const fresh = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assertSnapshotBasedFullRefresh(result, current, fresh, tracker.calls, "status-changed")
  } finally {
    await repo.cleanup()
  }
})

test("an unchanged dirty status refresh preserves patch and file identities", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "already dirty\n")
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const tracker = createTrackingGitPi()

    const result = await refreshWorkingTreeDocument(tracker.pi, context(repo.path), current, "status")

    assert.equal(result.reason, "status-unchanged")
    assert.equal(result.appliedScope, "status")
    assert.equal(result.document.files, current.files)
    assert.equal(result.document.raw, current.raw)
    assert.deepEqual(
      tracker.calls.map((call) => call.args[0]),
      ["status"],
    )
  } finally {
    await repo.cleanup()
  }
})

test("content changes behind an unchanged dirty status force a snapshot-based full refresh", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "first dirty content\n")
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    await writeRepoFile(repo.path, "tracked.txt", "second dirty content\n")
    const tracker = createTrackingGitPi()

    const result = await refreshWorkingTreeDocument(tracker.pi, context(repo.path), current, "status")
    const fresh = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assertSnapshotBasedFullRefresh(result, current, fresh, tracker.calls, "content-changed")
  } finally {
    await repo.cleanup()
  }
})

test("missing revisions and requested full scopes perform full loads", async () => {
  const repo = await createTempGitRepository()
  try {
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const withoutRevision = { ...current, revision: undefined }
    const missingTracker = createTrackingGitPi()
    const fullTracker = createTrackingGitPi()

    const missing = await refreshWorkingTreeDocument(missingTracker.pi, context(repo.path), withoutRevision, "status")
    const full = await refreshWorkingTreeDocument(fullTracker.pi, context(repo.path), current, "full")

    assert.equal(missing.reason, "missing-revision")
    assert.equal(missing.appliedScope, "full")
    assert.equal(full.reason, "requested-full")
    assert.equal(full.appliedScope, "full")
    assert.equal(missingTracker.calls[0]?.args[0], "rev-parse")
    assert.equal(fullTracker.calls[0]?.args[0], "rev-parse")
  } finally {
    await repo.cleanup()
  }
})

test("status refresh cancellation is terminal and starts no full-load process", async () => {
  const repo = await createTempGitRepository()
  try {
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const controller = new AbortController()
    const calls: string[][] = []
    const pi = {
      exec: async (_command: string, args: string[]) => {
        calls.push(args)
        controller.abort()
        return { stdout: "partial", stderr: "", code: 0, killed: true }
      },
    } as unknown as ExtensionAPI

    await assert.rejects(
      () => refreshWorkingTreeDocument(pi, context(repo.path, controller.signal), current, "status"),
      GitAbortError,
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.[0], "status")
  } finally {
    await repo.cleanup()
  }
})

test("configured command refresh scopes distinguish ref-only and content-changing commands", () => {
  assert.deepEqual(Object.fromEntries(GIT_COMMANDS.map((command) => [command.label, command.refresh])), {
    Fetch: { success: "status", failure: "status" },
    Pull: { success: "full", failure: "full" },
    "Pull (Rebase)": { success: "full", failure: "full" },
    Push: { success: "status", failure: "status" },
    "Force Push": { success: "status", failure: "status" },
  })
})
