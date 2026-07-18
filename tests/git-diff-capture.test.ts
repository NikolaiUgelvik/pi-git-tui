import assert from "node:assert/strict"
import { access, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { DEFAULT_TRACKED_DIFF_BUDGET } from "../src/diff-budgets.js"
import { captureTrackedDiff } from "../src/git-diff-capture.js"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import { captureHistoricalDiff } from "../src/git-historical-diff-capture.js"
import { GitAbortError, GitExitError } from "../src/git-service.js"
import { loadWorkingTreeSnapshot } from "../src/git-status.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  prepareCopyAndSourceChanges,
  runFixtureGit,
  stageUniqueFiles,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

function context(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function outputPaths(calls: readonly { args: readonly string[] }[]): string[] {
  return calls.flatMap((call) =>
    call.args.flatMap((argument) => (argument.startsWith("--output=") ? [argument.slice("--output=".length)] : [])),
  )
}

async function assertOutputPathsRemoved(paths: readonly string[]): Promise<void> {
  assert.equal(paths.length > 0, true)
  for (const path of paths) await assert.rejects(() => access(path))
}

async function stageLargeThenReplace(repo: { path: string }): Promise<void> {
  await writeRepoFile(repo.path, "staged-large.txt", "x".repeat(10 * 1024 * 1024))
  await runFixtureGit(repo.path, ["add", "staged-large.txt"])
  await writeRepoFile(repo.path, "staged-large.txt", "small worktree replacement\n")
}

function createIndexRacePi(repo: { path: string }, replacement: string) {
  const tracker = createTrackingGitPi()
  let stageListCalls = 0
  const pi = {
    exec: async (command: string, args: string[], options?: Parameters<ExtensionAPI["exec"]>[2]) => {
      if (args.includes("ls-files") && args.includes("--stage") && ++stageListCalls === 2) {
        await writeRepoFile(repo.path, "raced-index.txt", replacement)
        await runFixtureGit(repo.path, ["add", "raced-index.txt"])
      }
      return tracker.pi.exec(command, args, options)
    },
  } as ExtensionAPI
  return { pi, tracker }
}

function assertIndexRaceOmitted(
  capture: Awaited<ReturnType<typeof captureTrackedDiff>>,
  tracker: ReturnType<typeof createTrackingGitPi>,
): void {
  assert.equal(capture.raw, "")
  assert.equal(capture.omittedFiles[0]?.path, "raced-index.txt")
  assert.equal(capture.omittedFiles[0]?.omission?.reason, "changed-during-load")
  assert.equal(
    tracker.calls.some(
      (call) => call.args.includes("diff") && call.args.includes("--cached") && !call.args.includes("--quiet"),
    ),
    false,
  )
}

test("small tracked capture is byte-equivalent to one canonical aggregate git diff", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "alpha.txt", "before\n")
    await writeRepoFile(repo.path, "beta.txt", "before\n")
    await runFixtureGit(repo.path, ["add", "alpha.txt", "beta.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add files"])
    await writeRepoFile(repo.path, "alpha.txt", "after alpha\n")
    await writeRepoFile(repo.path, "beta.txt", "after beta\n")

    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    tracker.calls.length = 0
    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot)
    const canonical = await runFixtureGit(repo.path, [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--color=never",
      "HEAD",
      "--",
    ])

    assert.equal(capture.raw, canonical)
    assert.deepEqual(capture.omittedFiles, [])
    assert.equal(capture.capturedPatchBytes, Buffer.byteLength(canonical))
    assert.equal(tracker.calls.filter((call) => call.args.includes("diff")).length, 1)
  } finally {
    await repo.cleanup()
  }
})

test("tracked capture stays anchored to the snapshot commit when HEAD advances", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "snapshot change\n")
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    assert.equal(snapshot.head.kind, "attached")
    if (snapshot.head.kind !== "attached") return
    const snapshotOid = snapshot.head.oid

    await runFixtureGit(repo.path, ["add", "tracked.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "advance head"])
    await writeRepoFile(repo.path, "tracked.txt", "final worktree\n")
    tracker.calls.length = 0

    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot)

    assert.match(capture.raw, /^-initial$/mu)
    assert.match(capture.raw, /^\+final worktree$/mu)
    assert.doesNotMatch(capture.raw, /^-snapshot change$/mu)
    const treeishCalls = tracker.calls.filter(
      (call) => call.args.includes("ls-tree") || (call.args.includes("diff") && !call.args.includes("--quiet")),
    )
    assert.equal(treeishCalls.length > 0, true)
    assert.equal(
      treeishCalls.every((call) => call.args.includes(snapshotOid)),
      true,
    )
    assert.equal(
      treeishCalls.some((call) => call.args.includes("HEAD")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("a clean snapshot never captures a post-snapshot tracked mutation", async () => {
  const repo = await createTempGitRepository()
  try {
    const snapshotTracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(snapshotTracker.pi, repo.path)
    await writeRepoFile(repo.path, "tracked.txt", "x".repeat(10 * 1024 * 1024))
    const captureTracker = createTrackingGitPi()

    const capture = await captureTrackedDiff(captureTracker.pi, repo.path, snapshot)

    assert.equal(capture.raw, "")
    assert.deepEqual(capture.omittedFiles, [])
    const snapshotOid = snapshot.head.kind === "initial" ? undefined : snapshot.head.oid
    assert.deepEqual(
      captureTracker.calls.map((call) => call.args.join(" ")),
      [`diff --quiet ${snapshotOid} --`],
    )
  } finally {
    await repo.cleanup()
  }
})

test("dirty snapshots restrict capture to their selected literal paths", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "other.txt", "before\n")
    await runFixtureGit(repo.path, ["add", "other.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add other"])
    await writeRepoFile(repo.path, "tracked.txt", "snapshot change\n")
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    await writeRepoFile(repo.path, "other.txt", "x".repeat(10 * 1024 * 1024))
    const tracker = createTrackingGitPi()

    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot)

    assert.equal(capture.raw.includes("tracked.txt"), true)
    assert.equal(capture.raw.includes("other.txt"), false)
    assert.equal(tracker.calls.at(-1)?.args.at(-1), "tracked.txt")
  } finally {
    await repo.cleanup()
  }
})

test("a ten-megabyte tracked file is omitted before spawning a patch capture", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "x".repeat(10 * 1024 * 1024))
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const file = document.files.find((candidate) => candidate.path === "tracked.txt")

    assert.equal(file?.omission?.reason, "file-too-large")
    assert.equal(file?.omission?.measuredBytes, 10 * 1024 * 1024)
    assert.equal(file?.omission?.limitBytes, DEFAULT_TRACKED_DIFF_BUDGET.maxFileBytes)
    assert.equal(document.raw, "")
    assert.equal(document.omittedFileCount, 1)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("diff") && !call.args.includes("--raw")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("the initial repository file budget bounds total object-size probes", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await stageUniqueFiles(repo.path, 20)
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    tracker.calls.length = 0

    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      maxFiles: 5,
    })

    assert.equal(capture.omittedFiles.length, 15)
    assert.equal(
      capture.omittedFiles.every((file) => file.omission?.reason === "file-count-budget"),
      true,
    )
    assert.equal(tracker.calls.filter((call) => call.args[0] === "cat-file").length <= 5, true)
  } finally {
    await repo.cleanup()
  }
})

test("initial object-size failures propagate instead of becoming race omissions", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await writeRepoFile(repo.path, "staged.txt", "content\n")
    await runFixtureGit(repo.path, ["add", "staged.txt"])
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    const tracker = createTrackingGitPi()
    const pi = {
      exec: async (command: string, args: string[], options?: Parameters<ExtensionAPI["exec"]>[2]) =>
        args[0] === "cat-file"
          ? { stdout: "", stderr: "fatal: bad object", code: 128, killed: false }
          : tracker.pi.exec(command, args, options),
    } as ExtensionAPI

    await assert.rejects(() => captureTrackedDiff(pi, repo.path, snapshot), GitExitError)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("diff") && call.args.includes("--cached")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("initial repositories budget staged object content rather than a replaced worktree file", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await stageLargeThenReplace(repo)
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const file = document.files.find((candidate) => candidate.path === "staged-large.txt")

    assert.equal(file?.omission?.reason, "file-too-large")
    assert.equal(file?.omission?.measuredBytes, 10 * 1024 * 1024)
    assert.equal(document.capturedPatchBytes, 0)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("--cached") && call.args.includes("diff")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("initial capture rejects index identity changes after object sizing", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await writeRepoFile(repo.path, "raced-index.txt", "small\n")
    await runFixtureGit(repo.path, ["add", "raced-index.txt"])
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    const { pi, tracker } = createIndexRacePi(repo, "x".repeat(10 * 1024 * 1024))

    const capture = await captureTrackedDiff(pi, repo.path, snapshot)

    assertIndexRaceOmitted(capture, tracker)
  } finally {
    await repo.cleanup()
  }
})

test("non-initial staged capture budgets both HEAD and index objects", async () => {
  const repo = await createTempGitRepository()
  try {
    await stageLargeThenReplace(repo)
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const staged = document.staged.files.find((candidate) => candidate.path === "staged-large.txt")

    assert.equal(staged?.omission?.reason, "file-too-large")
    assert.equal(staged?.omission?.measuredBytes, 10 * 1024 * 1024)
    assert.equal(document.staged.capturedPatchBytes, 0)
    assert.equal(
      tracker.calls.some(
        (call) => call.args.includes("diff") && call.args.includes("--cached") && !call.args.includes("--quiet"),
      ),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("non-initial staged capture rejects index identity changes before patch capture", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "raced-index.txt", "small staged change\n")
    await runFixtureGit(repo.path, ["add", "raced-index.txt"])
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    const { pi, tracker } = createIndexRacePi(repo, "replacement staged during capture\n")

    const capture = await captureTrackedDiff(pi, repo.path, snapshot, undefined, undefined, "staged")

    assertIndexRaceOmitted(capture, tracker)
  } finally {
    await repo.cleanup()
  }
})

test("tracked capture disables repository textconv filters", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, ".gitattributes", "*.foo diff=review\n")
    await writeRepoFile(repo.path, "tracked.foo", "before\n")
    await runFixtureGit(repo.path, ["add", ".gitattributes", "tracked.foo"])
    await runFixtureGit(repo.path, ["commit", "-m", "add textconv fixture"])
    const marker = join(repo.path, ".git", "textconv-ran")
    const converter = join(repo.path, ".git", "textconv.mjs")
    await writeFile(
      converter,
      `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "ran")\nprocess.stdout.write("converted\\n")\n`,
    )
    await runFixtureGit(repo.path, [
      "config",
      "diff.review.textconv",
      `${JSON.stringify(process.execPath)} ${JSON.stringify(converter)}`,
    ])
    await writeRepoFile(repo.path, "tracked.foo", "after\n")
    const tracker = createTrackingGitPi()

    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))

    assert.equal(document.files.find((file) => file.path === "tracked.foo")?.omission, undefined)
    assert.match(document.raw, /^-before$/mu)
    assert.match(document.raw, /^\+after$/mu)
    await assert.rejects(() => access(marker))
    assert.equal(
      tracker.calls
        .filter((call) => call.args.includes("diff") && !call.args.includes("--quiet"))
        .every((call) => call.args.includes("--no-textconv")),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("tracked binary and symbolic-link patches remain canonical entries", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeFile(join(repo.path, "binary.dat"), Buffer.from([0, 1, 2, 0, 3]))
    await symlink("first-target", join(repo.path, "link.txt"))
    await runFixtureGit(repo.path, ["add", "binary.dat", "link.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add binary and link"])
    await writeFile(join(repo.path, "binary.dat"), Buffer.from([0, 9, 8, 0, 7]))
    await rm(join(repo.path, "link.txt"))
    await symlink("second-target", join(repo.path, "link.txt"))

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const byPath = new Map(document.files.map((file) => [file.path, file]))

    assert.equal(byPath.get("binary.dat")?.status, "binary")
    assert.equal(byPath.get("binary.dat")?.omission, undefined)
    assert.equal(byPath.get("link.txt")?.status, "modified")
    assert.equal(
      byPath.get("link.txt")?.lines.some((line) => line === "-first-target"),
      true,
    )
    assert.equal(
      byPath.get("link.txt")?.lines.some((line) => line === "+second-target"),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("tracked files that disappear during capture are not retained", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "modified before capture\n")
    const snapshotTracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(snapshotTracker.pi, repo.path)
    const captureTracker = createTrackingGitPi()
    let removed = false
    const pi = {
      exec: async (command: string, args: string[], options?: Parameters<ExtensionAPI["exec"]>[2]) => {
        if (!removed && args.includes("diff") && !args.includes("--quiet")) {
          removed = true
          await rm(join(repo.path, "tracked.txt"))
        }
        return captureTracker.pi.exec(command, args, options)
      },
    } as ExtensionAPI

    const capture = await captureTrackedDiff(pi, repo.path, snapshot)

    assert.equal(capture.raw, "")
    assert.equal(capture.omittedFiles[0]?.path, "tracked.txt")
    assert.equal(capture.omittedFiles[0]?.omission?.reason, "changed-during-load")
  } finally {
    await repo.cleanup()
  }
})

test("final tracked patch commands honor configured literal-path batches", async () => {
  const repo = await createTempGitRepository()
  const paths = ["batch-a.txt", "batch-b.txt", "batch-c.txt"]
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "before\n")))
    await runFixtureGit(repo.path, ["add", ...paths])
    await runFixtureGit(repo.path, ["commit", "-m", "add batch fixtures"])
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "after\n")))
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    tracker.calls.length = 0

    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      argvChunkPaths: 1,
      argvChunkBytes: 1024,
    })

    const patchCalls = tracker.calls.filter((call) => call.args.includes("diff") && !call.args.includes("--quiet"))
    assert.equal(patchCalls.length, paths.length)
    assert.equal(
      patchCalls.every((call) => call.args.slice((call.args.lastIndexOf("--") ?? -1) + 1).length === 1),
      true,
    )
    assert.equal(
      paths.every((path) => capture.raw.includes(`diff --git a/${path} b/${path}`)),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("connected copy batches capture each represented patch exactly once", async () => {
  const repo = await createTempGitRepository()
  try {
    await prepareCopyAndSourceChanges(repo.path)
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)

    const capture = await captureTrackedDiff(createTrackingGitPi().pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      argvChunkPaths: 2,
      argvChunkBytes: 1024,
    })

    assert.equal(occurrenceCount(capture.raw, "diff --git a/source.txt b/source.txt"), 1)
    assert.equal(occurrenceCount(capture.raw, "diff --git a/source.txt b/copy.txt"), 1)
    assert.equal(capture.omittedFiles.length, 0)
  } finally {
    await repo.cleanup()
  }
})

test("historical connected copy batches capture each represented patch exactly once", async () => {
  const repo = await createTempGitRepository()
  try {
    await prepareCopyAndSourceChanges(repo.path)
    await runFixtureGit(repo.path, ["commit", "-m", "copy and modify source"])
    const commit = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()

    const capture = await captureHistoricalDiff(createTrackingGitPi().pi, repo.path, commit, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      argvChunkPaths: 2,
      argvChunkBytes: 1024,
    })

    assert.equal(occurrenceCount(capture.raw, "diff --git a/source.txt b/source.txt"), 1)
    assert.equal(occurrenceCount(capture.raw, "diff --git a/source.txt b/copy.txt"), 1)
    assert.equal(capture.omittedFiles.length, 0)
  } finally {
    await repo.cleanup()
  }
})

test("historical metadata is streamed into a bounded explicit summary", async () => {
  const repo = await createTempGitRepository()
  try {
    const paths = Array.from({ length: 5 }, (_, index) => `historical-${index}.txt`)
    await Promise.all(paths.map((path, index) => writeRepoFile(repo.path, path, `content ${index}\n`)))
    await runFixtureGit(repo.path, ["add", ...paths])
    await runFixtureGit(repo.path, ["commit", "-m", "add historical files"])
    const commit = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()
    const tracker = createTrackingGitPi()

    const capture = await captureHistoricalDiff(tracker.pi, repo.path, commit, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      maxFiles: 2,
    })

    assert.equal(capture.omittedFileCount, 3)
    assert.equal(capture.omittedFiles.length, 1)
    assert.equal(capture.omittedFiles[0]?.omission?.reason, "file-count-budget")
    assert.match(capture.omittedFiles[0]?.path ?? "", /3 additional changed files/u)
    assert.equal(occurrenceCount(capture.raw, "diff --git "), 2)
    assert.equal(
      tracker.calls.filter((call) => call.args.includes("--raw")).every((call) => outputPaths([call]).length === 1),
      true,
    )
    await assertOutputPathsRemoved(outputPaths(tracker.calls))
  } finally {
    await repo.cleanup()
  }
})

test("historical output files are removed after failure and cancellation", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "historical.txt", "historical\n")
    await runFixtureGit(repo.path, ["add", "historical.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add historical"])
    const commit = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()

    for (const mode of ["failure", "abort"] as const) {
      const tracker = createTrackingGitPi()
      const controller = new AbortController()
      const pi = {
        exec: async (command: string, args: string[], options?: Parameters<ExtensionAPI["exec"]>[2]) => {
          const result = await tracker.pi.exec(command, args, options)
          if (!args.includes("--raw")) return result
          if (mode === "abort") controller.abort()
          return mode === "failure" ? { ...result, code: 2, stderr: "forced output failure" } : result
        },
      } as ExtensionAPI

      await assert.rejects(
        () => captureHistoricalDiff(pi, repo.path, commit, undefined, controller.signal),
        mode === "failure" ? GitExitError : GitAbortError,
      )
      await assertOutputPathsRemoved(outputPaths(tracker.calls))
    }
  } finally {
    await repo.cleanup()
  }
})

test("tracked retained-output line limits discard whole file chunks", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"))
    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      maxPatchLines: 5,
    })

    assert.equal(capture.raw, "")
    assert.equal(capture.omittedFiles.length, 1)
    assert.equal(capture.omittedFiles[0]?.omission?.reason, "aggregate-line-budget")
    assert.equal(capture.omittedFiles[0]?.lines.length, 0)
  } finally {
    await repo.cleanup()
  }
})

test("rename source and destination are omitted as one atomic group", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "old name.txt", "rename content\n")
    await runFixtureGit(repo.path, ["add", "old name.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add rename source"])
    await runFixtureGit(repo.path, ["mv", "old name.txt", "new name.txt"])

    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      maxFileBytes: 1,
    })

    assert.equal(capture.raw, "")
    assert.equal(capture.omittedFiles.length, 1)
    assert.deepEqual(
      {
        path: capture.omittedFiles[0]?.path,
        oldPath: capture.omittedFiles[0]?.oldPath,
        newPath: capture.omittedFiles[0]?.newPath,
        status: capture.omittedFiles[0]?.status,
      },
      { path: "new name.txt", oldPath: "old name.txt", newPath: "new name.txt", status: "renamed" },
    )
  } finally {
    await repo.cleanup()
  }
})

test("status and diff rename-limit mismatches do not create phantom omissions", async () => {
  const repo = await createTempGitRepository()
  const pairs = Array.from({ length: 3 }, (_, index) => ({ old: `old-${index}.txt`, next: `new-${index}.txt` }))
  try {
    await Promise.all(
      pairs.map(({ old }, index) => writeRepoFile(repo.path, old, `shared line\nunique ${index}\noriginal\n`)),
    )
    await runFixtureGit(repo.path, ["add", ...pairs.map(({ old }) => old)])
    await runFixtureGit(repo.path, ["commit", "-m", "add rename-limit fixtures"])
    await runFixtureGit(repo.path, ["config", "status.renameLimit", "1"])
    for (const [index, pair] of pairs.entries()) {
      await runFixtureGit(repo.path, ["mv", pair.old, pair.next])
      await writeRepoFile(repo.path, pair.next, `shared line\nunique ${index}\nchanged\n`)
    }
    await runFixtureGit(repo.path, ["add", "--all"])

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assert.equal(document.omittedFileCount, 0)
    assert.deepEqual(
      document.files.map((file) => [file.path, file.status]),
      pairs.map(({ next }) => [next, "renamed"]),
    )
  } finally {
    await repo.cleanup()
  }
})

test("copy groups apply the per-file limit to each file rather than their combined size", async () => {
  const repo = await createTempGitRepository()
  try {
    const content = `${"x".repeat(1200 * 1024)}\n`
    await writeRepoFile(repo.path, "source.txt", content)
    await runFixtureGit(repo.path, ["add", "source.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add copy source"])
    await runFixtureGit(repo.path, ["config", "status.renames", "copies"])
    await writeRepoFile(repo.path, "copied.txt", content)
    await writeRepoFile(repo.path, "source.txt", `${content}changed\n`)
    await runFixtureGit(repo.path, ["add", "source.txt", "copied.txt"])

    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot, {
      ...DEFAULT_TRACKED_DIFF_BUDGET,
      maxFileBytes: 2 * 1024 * 1024,
      maxTotalBytes: 5 * 1024 * 1024,
    })

    assert.equal(
      capture.omittedFiles.some((file) => file.path === "copied.txt" && file.omission?.reason === "file-too-large"),
      false,
    )
    assert.match(capture.raw, /copy to copied\.txt/u)
  } finally {
    await repo.cleanup()
  }
})

test("aggregate tracked source budget keeps a deterministic prefix of files", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 5 }, (_, index) => `large-${index}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "before\n")))
    await runFixtureGit(repo.path, ["add", ...paths])
    await runFixtureGit(repo.path, ["commit", "-m", "add large fixtures"])
    const content = "x".repeat(1900 * 1024)
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, content)))

    const tracker = createTrackingGitPi()
    const snapshot = await loadWorkingTreeSnapshot(tracker.pi, repo.path)
    const capture = await captureTrackedDiff(tracker.pi, repo.path, snapshot)

    assert.equal(capture.omittedFiles.at(-1)?.path, "large-4.txt")
    assert.equal(capture.omittedFiles.at(-1)?.omission?.reason, "aggregate-byte-budget")
    assert.equal(capture.capturedPatchBytes <= DEFAULT_TRACKED_DIFF_BUDGET.maxPatchBytes, true)
    assert.equal(capture.raw.includes("diff --git a/large-0.txt b/large-0.txt"), true)
    assert.equal(capture.raw.includes("diff --git a/large-4.txt b/large-4.txt"), false)
  } finally {
    await repo.cleanup()
  }
})
