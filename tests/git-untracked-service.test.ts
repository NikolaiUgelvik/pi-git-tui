import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { promisify } from "node:util"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { DEFAULT_UNTRACKED_DIFF_BUDGET } from "../src/diff-budgets.js"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import { loadWorkingTreeSnapshot, type WorkingTreeSnapshot } from "../src/git-status.js"
import { loadUntrackedDiffs } from "../src/git-untracked-service.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

const execFileAsync = promisify(execFile)

type RawGitResult = { stdout: string; stderr: string; code: number; killed: boolean }

function context(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext
}

async function noIndexPatch(cwd: string, path: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "git",
      ["--literal-pathspecs", "-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", path],
      { cwd, encoding: "utf8" },
    )
    return result.stdout
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1 && "stdout" in error) {
      return String(error.stdout)
    }
    throw error
  }
}

function syntheticSnapshot(paths: readonly string[]): WorkingTreeSnapshot {
  return {
    head: { kind: "attached", oid: "a".repeat(40), branch: "main" },
    entries: [],
    stagedPaths: new Set(),
    conflictedPaths: new Set(),
    untrackedPaths: [...paths],
    headTrackedPaths: new Set(),
    indexFingerprint: "synthetic-index",
    statusFingerprint: "synthetic",
    clean: paths.length === 0,
  }
}

function patchFor(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+${path}`,
    "",
  ].join("\n")
}

test("zero untracked paths start no eligibility or diff processes", async () => {
  const repo = await createTempGitRepository()
  try {
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    tracker.calls.length = 0

    assert.deepEqual(await loadUntrackedDiffs(tracker.pi, repo.path, snapshot), [])
    assert.deepEqual(tracker.calls, [])
  } finally {
    await repo.cleanup()
  }
})

test("small untracked patches remain canonical and ordered", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 10 }, (_, index) => `file-${String(index).padStart(2, "0")}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, `${path}\n`)))
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    tracker.calls.length = 0

    const results = await loadUntrackedDiffs(tracker.pi, repo.path, snapshot)

    assert.deepEqual(
      results.map((result) => result.path),
      paths,
    )
    assert.equal(
      results.every((result) => result.kind === "patch"),
      true,
    )
    const first = results[0]
    assert.equal(first?.kind, "patch")
    if (first?.kind === "patch") {
      assert.equal(first.raw, await noIndexPatch(repo.path, first.path))
    }
    assert.equal(tracker.calls.filter((call) => call.args.includes("--no-index")).length, 10)
    assert.equal(tracker.peakActive() <= DEFAULT_UNTRACKED_DIFF_BUDGET.concurrency, true)
  } finally {
    await repo.cleanup()
  }
})

test("fifty eligible files use at most sixty Git processes and peak four", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 50 }, (_, index) => `fifty/file-${String(index).padStart(2, "0")}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "small\n")))
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))

    assert.equal(document.files.length, 50)
    assert.equal(document.omittedFileCount, 0)
    assert.equal(tracker.calls.length <= 60, true)
    assert.equal(tracker.calls.filter((call) => call.args.includes("--no-index")).length, 50)
    assert.equal(tracker.peakActive(), DEFAULT_UNTRACKED_DIFF_BUDGET.concurrency)
  } finally {
    await repo.cleanup()
  }
})

test("five hundred untracked files retain one hundred patches and explicit ordered omissions", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 500 }, (_, index) => `bulk/file-${String(index).padStart(3, "0")}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "small\n")))
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))

    assert.equal(document.files.length, 500)
    assert.equal(document.omittedFileCount, 400)
    assert.deepEqual(
      document.files.slice(100, 103).map((file) => [file.path, file.omission?.reason]),
      paths.slice(100, 103).map((path) => [path, "file-count-budget"]),
    )
    assert.equal(tracker.calls.filter((call) => call.args.includes("--no-index")).length, 100)
    assert.equal(tracker.peakActive() <= DEFAULT_UNTRACKED_DIFF_BUDGET.concurrency, true)
    assert.equal(document.capturedPatchBytes <= DEFAULT_UNTRACKED_DIFF_BUDGET.maxPatchBytes, true)
  } finally {
    await repo.cleanup()
  }
})

test("aggregate source and retained-output budgets stop large untracked scheduling", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 40 }, (_, index) => `large/file-${String(index).padStart(2, "0")}.txt`)
  try {
    const content = "x".repeat(200 * 1024)
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, content)))
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const noIndexCalls = tracker.calls.filter((call) => call.args.includes("--no-index")).length

    assert.equal(noIndexCalls <= 10, true)
    assert.equal(document.omittedFileCount >= 30, true)
    assert.equal(document.capturedPatchBytes <= DEFAULT_UNTRACKED_DIFF_BUDGET.maxPatchBytes, true)
    assert.equal(
      document.files.some((file) => file.omission?.reason === "aggregate-byte-budget"),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("binary, symbolic-link, broken-link, empty, and oversized paths remain explicit", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeFile(join(repo.path, "binary.dat"), Buffer.from([0, 1, 2, 0, 3]))
    await writeRepoFile(repo.path, "target.txt", "target\n")
    await symlink("target.txt", join(repo.path, "link.txt"))
    await symlink("missing.txt", join(repo.path, "broken.txt"))
    await writeRepoFile(repo.path, "empty odd name.txt", "")
    await writeRepoFile(repo.path, "oversized.txt", "x".repeat(DEFAULT_UNTRACKED_DIFF_BUDGET.maxFileBytes + 1))

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const byPath = new Map(document.files.map((file) => [file.path, file]))

    assert.equal(byPath.get("binary.dat")?.status, "binary")
    assert.equal(byPath.get("link.txt")?.omission, undefined)
    assert.equal(byPath.get("broken.txt")?.omission, undefined)
    assert.equal(byPath.get("empty odd name.txt")?.status, "added")
    assert.equal(byPath.get("empty odd name.txt")?.lines[0], "diff --git a/empty odd name.txt b/empty odd name.txt")
    assert.equal(byPath.get("oversized.txt")?.omission?.reason, "file-too-large")
  } finally {
    await repo.cleanup()
  }
})

test("an untracked path added to the index after the snapshot is reported as changed", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "raced.txt", "raced\n")
    const snapshot = syntheticSnapshot(["raced.txt"])
    await runFixtureGit(repo.path, ["add", "raced.txt"])

    const results = await loadUntrackedDiffs(createTrackingGitPi().pi, repo.path, snapshot)

    assert.equal(results.length, 1)
    assert.equal(results[0]?.kind, "omitted")
    if (results[0]?.kind === "omitted") {
      assert.equal(results[0].reason, "changed-during-load")
    }
  } finally {
    await repo.cleanup()
  }
})

test("later aggregate omissions do not report non-exceeding measurements", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "a-eight.txt", "12345678")
    await writeRepoFile(repo.path, "b-three.txt", "123")
    await writeRepoFile(repo.path, "c-one.txt", "1")
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)

    const results = await loadUntrackedDiffs(createTrackingGitPi().pi, repo.path, snapshot, {
      ...DEFAULT_UNTRACKED_DIFF_BUDGET,
      maxTotalBytes: 10,
    })
    const second = results.find((result) => result.path === "b-three.txt")
    const third = results.find((result) => result.path === "c-one.txt")

    assert.equal(second?.kind, "omitted")
    assert.equal(third?.kind, "omitted")
    if (second?.kind === "omitted" && third?.kind === "omitted") {
      assert.equal(second.omission.measuredBytes, 11)
      assert.equal(third.omission.measuredBytes, undefined)
      assert.equal(third.omission.message.includes("10 B"), true)
      assert.equal(third.omission.message.includes("exceeds"), false)
    }
  } finally {
    await repo.cleanup()
  }
})

test("membership changes after patch capture discard the stale untracked patch", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "staged-during-load.txt", "same bytes\n")
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    const tracker = createTrackingGitPi()
    let staged = false
    const pi = {
      exec: async (command: string, args: string[], options?: Parameters<ExtensionAPI["exec"]>[2]) => {
        const result = await tracker.pi.exec(command, args, options)
        if (!staged && args.includes("--no-index")) {
          staged = true
          await runFixtureGit(repo.path, ["add", "staged-during-load.txt"])
        }
        return result
      },
    } as ExtensionAPI

    const results = await loadUntrackedDiffs(pi, repo.path, snapshot)

    assert.equal(results[0]?.kind, "omitted")
    if (results[0]?.kind === "omitted") {
      assert.equal(results[0].reason, "changed-during-load")
    }
  } finally {
    await repo.cleanup()
  }
})

test("untracked retained-output line budgets omit complete patches", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(
      repo.path,
      "many-lines.txt",
      Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"),
    )
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)

    const results = await loadUntrackedDiffs(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_UNTRACKED_DIFF_BUDGET,
      maxPatchLines: 5,
    })

    assert.equal(results.length, 1)
    assert.equal(results[0]?.kind, "omitted")
    if (results[0]?.kind === "omitted") {
      assert.equal(results[0].reason, "aggregate-line-budget")
      assert.equal(results[0].omission.limitLines, 5)
    }
  } finally {
    await repo.cleanup()
  }
})

test("directories and disappearing candidates become explicit omissions", async () => {
  const repo = await createTempGitRepository()
  try {
    await mkdir(join(repo.path, "directory"))
    await writeRepoFile(repo.path, "gone.txt", "gone\n")
    const snapshot = syntheticSnapshot(["directory", "gone.txt"])
    await writeFile(join(repo.path, "gone.txt"), "gone\n")
    await rm(join(repo.path, "gone.txt"))

    const results = await loadUntrackedDiffs(createTrackingGitPi().pi, repo.path, snapshot)

    assert.deepEqual(
      results.map((result) => [result.path, result.kind === "omitted" ? result.reason : undefined]),
      [
        ["directory", "unsupported-file"],
        ["gone.txt", "changed-during-load"],
      ],
    )
  } finally {
    await repo.cleanup()
  }
})

test("out-of-order worker completion preserves input order and peak four", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 8 }, (_, index) => `ordered-${index}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, `${path}\n`)))
    let active = 0
    let peak = 0
    const pi = {
      exec: async (_command: string, args: string[]): Promise<RawGitResult> => {
        if (args.includes("ls-files") || args.includes("ls-tree")) {
          return { stdout: "", stderr: "", code: 0, killed: false }
        }
        if (args.includes("--no-index")) {
          const path = args.at(-1) ?? ""
          active++
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, (paths.length - paths.indexOf(path)) * 2))
          active--
          return { stdout: patchFor(path), stderr: "", code: 1, killed: false }
        }
        return { stdout: "", stderr: "unexpected command", code: 2, killed: false }
      },
    } as unknown as ExtensionAPI

    const results = await loadUntrackedDiffs(pi, repo.path, syntheticSnapshot(paths))

    assert.deepEqual(
      results.map((result) => result.path),
      paths,
    )
    assert.equal(peak, 4)
  } finally {
    await repo.cleanup()
  }
})
