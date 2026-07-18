import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { collectCommitDiffInput, parseStagedRawDiff, type StagedEntry } from "../src/commit-diff-input.js"
import { DEFAULT_COMMIT_PROMPT_BUDGET } from "../src/diff-budgets.js"
import { splitGitPatch, textLineCount } from "../src/git-patch.js"
import { GitExitError } from "../src/git-service.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  prepareCopyAndSourceChanges,
  runFixtureGit,
  stageUniqueFiles,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1
}

test("parseStagedRawDiff preserves rename pairs and odd NUL-delimited paths", () => {
  const oldPath = "old name.txt"
  const newPath = "new\tλ\nname.txt"
  const raw = [
    `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} R091`,
    oldPath,
    newPath,
    `:000000 100644 ${"0".repeat(40)} ${"c".repeat(40)} A`,
    "-leading[glob]*.txt",
    "",
  ].join("\0")

  const entries: StagedEntry[] = parseStagedRawDiff(raw)

  assert.deepEqual(
    entries.map((entry) => ({ path: entry.path, originalPath: entry.originalPath, paths: entry.paths })),
    [
      { path: newPath, originalPath: oldPath, paths: [oldPath, newPath] },
      { path: "-leading[glob]*.txt", originalPath: undefined, paths: ["-leading[glob]*.txt"] },
    ],
  )
})

test("object-size failures are not hidden as changed-during-load omissions", async () => {
  const oid = "a".repeat(40)
  const raw = `:000000 100644 ${"0".repeat(40)} ${oid} A\0changed.txt\0`
  const calls: string[] = []
  const pi = {
    exec: async (_command: string, args: string[]) => {
      const command = args.join(" ")
      calls.push(command)
      if (command === "rev-parse --show-toplevel") {
        return { stdout: "/repo\n", stderr: "", code: 0, killed: false }
      }
      if (args.includes("--raw")) {
        return { stdout: raw, stderr: "", code: 0, killed: false }
      }
      if (args[0] === "cat-file") {
        return { stdout: "", stderr: "missing object", code: 128, killed: false }
      }
      return { stdout: "", stderr: "unexpected", code: 2, killed: false }
    },
  } as unknown as ExtensionAPI

  await assert.rejects(() => collectCommitDiffInput(pi, "/repo"), GitExitError)

  assert.equal(
    calls.some((call) => call.includes("--patch")),
    false,
  )
})

test("index identity changes before capture prevent path-based patch substitution", async () => {
  const firstOid = "a".repeat(40)
  const secondOid = "b".repeat(40)
  const firstRaw = `:000000 100644 ${"0".repeat(40)} ${firstOid} A\0changed.txt\0`
  const secondRaw = `:000000 100644 ${"0".repeat(40)} ${secondOid} A\0changed.txt\0`
  let rawCalls = 0
  const calls: string[] = []
  const pi = {
    exec: async (_command: string, args: string[]) => {
      calls.push(args.join(" "))
      if (args.join(" ") === "rev-parse --show-toplevel") {
        return { stdout: "/repo\n", stderr: "", code: 0, killed: false }
      }
      if (args.includes("--raw")) {
        return { stdout: rawCalls++ === 0 ? firstRaw : secondRaw, stderr: "", code: 0, killed: false }
      }
      if (args[0] === "cat-file") {
        return { stdout: "1\n", stderr: "", code: 0, killed: false }
      }
      return { stdout: "", stderr: "unexpected", code: 2, killed: false }
    },
  } as unknown as ExtensionAPI

  const input = await collectCommitDiffInput(pi, "/repo")

  assert.equal(input.includedFiles, 0)
  assert.equal(input.omittedFiles, 1)
  assert.equal(input.text.includes("changed while"), true)
  assert.equal(
    calls.some((call) => call.includes("--patch")),
    false,
  )
})

test("small staged input uses bounded size probes and one combined stat-patch command", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "first.txt", "first staged\n")
    await writeRepoFile(repo.path, "second.txt", "second staged\n")
    await runFixtureGit(repo.path, ["add", "first.txt", "second.txt"])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path)

    assert.equal(input.includedFiles, 2)
    assert.equal(input.omittedFiles, 0)
    assert.equal(input.text.includes("diff --git a/first.txt b/first.txt"), true)
    assert.equal(input.text.includes("2 files changed"), true)
    assert.equal(input.text.length <= DEFAULT_COMMIT_PROMPT_BUDGET.maxInputChars, true)
    assert.equal(tracker.calls.filter((call) => call.args[0] === "cat-file").length, 2)
    assert.equal(
      tracker.calls.filter((call) => call.args.includes("--stat") && call.args.includes("--patch")).length,
      1,
    )
    assert.equal(tracker.peakActive() <= DEFAULT_COMMIT_PROMPT_BUDGET.concurrency, true)
  } finally {
    await repo.cleanup()
  }
})

test("large staged deletions are omitted using their old object size", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "large-delete.txt", "x".repeat(2 * 1024 * 1024))
    await runFixtureGit(repo.path, ["add", "large-delete.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add deletion fixture"])
    await runFixtureGit(repo.path, ["rm", "large-delete.txt"])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path)

    assert.equal(input.includedFiles, 0)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.text.includes("large-delete.txt"), true)
    assert.equal(input.text.includes("2.0 MiB"), true)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("--patch")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("large old objects cannot hide behind small staged replacements", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "large-replace.txt", "x".repeat(1024 * 1024))
    await runFixtureGit(repo.path, ["add", "large-replace.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add replacement fixture"])
    await writeRepoFile(repo.path, "large-replace.txt", "small\n")
    await runFixtureGit(repo.path, ["add", "large-replace.txt"])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path)

    assert.equal(input.includedFiles, 0)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.text.includes("large-replace.txt"), true)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("--patch")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("an eight-megabyte staged file is omitted without capturing its patch", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "huge-staged.txt", "x".repeat(8 * 1024 * 1024))
    await runFixtureGit(repo.path, ["add", "huge-staged.txt"])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path)

    assert.equal(input.includedFiles, 0)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.capturedPatchChars, 0)
    assert.equal(input.text.includes("huge-staged.txt"), true)
    assert.equal(input.text.includes("8.0 MiB"), true)
    assert.equal(input.text.length <= DEFAULT_COMMIT_PROMPT_BUDGET.maxInputChars, true)
    assert.equal(
      tracker.calls.some((call) => call.args.includes("--stat") || call.args.includes("--patch")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("prompt patch budgets retain only complete diff --git records", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "a-first.txt", `${"first line\n".repeat(20)}`)
    await writeRepoFile(repo.path, "b-second.txt", `${"second line\n".repeat(20)}`)
    await runFixtureGit(repo.path, ["add", "a-first.txt", "b-second.txt"])
    const canonical = await runFixtureGit(repo.path, [
      "--literal-pathspecs",
      "-c",
      "core.quotepath=false",
      "diff",
      "--cached",
      "--stat",
      "--patch",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--color=never",
      "--",
      "a-first.txt",
      "b-second.txt",
    ])
    const chunks = splitGitPatch(canonical).chunks
    const firstChunk = chunks[0]
    assert.ok(firstChunk)

    const input = await collectCommitDiffInput(createTrackingGitPi().pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      maxPatchChars: firstChunk.length,
    })

    assert.equal(input.includedFiles, 1)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.capturedPatchChars, firstChunk.length)
    assert.equal(input.text.includes(firstChunk), true)
    assert.equal(input.text.includes("diff --git a/b-second.txt b/b-second.txt"), false)
    assert.equal(input.text.includes("b-second.txt"), true)
    assert.equal(input.text.includes("[diff truncated]"), false)
  } finally {
    await repo.cleanup()
  }
})

test("final commit patch commands honor configured literal-path batches", async () => {
  const repo = await createTempGitRepository()
  const paths = ["batch-a.txt", "batch-b.txt", "batch-c.txt"]
  try {
    await Promise.all(paths.map((path, index) => writeRepoFile(repo.path, path, `staged-${index}\n`)))
    await runFixtureGit(repo.path, ["add", ...paths])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      argvChunkPaths: 1,
      argvChunkBytes: 1024,
    })

    const patchCalls = tracker.calls.filter((call) => call.args.includes("--patch"))
    assert.deepEqual(
      patchCalls.map((call) => call.args.slice(call.args.lastIndexOf("--") + 1)),
      paths.map((path) => [path]),
    )
    assert.equal(input.includedFiles, paths.length)
    for (const path of paths) assert.match(input.text, new RegExp(`diff --git a/${path} b/${path}`, "u"))
  } finally {
    await repo.cleanup()
  }
})

test("connected staged copy batches capture each represented patch exactly once", async () => {
  const repo = await createTempGitRepository()
  try {
    await prepareCopyAndSourceChanges(repo.path)

    const input = await collectCommitDiffInput(createTrackingGitPi().pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      argvChunkPaths: 2,
      argvChunkBytes: 1024,
    })

    assert.equal(occurrenceCount(input.text, "diff --git a/source.txt b/source.txt"), 1)
    assert.equal(occurrenceCount(input.text, "diff --git a/source.txt b/copy.txt"), 1)
    assert.equal(input.omittedFiles, 0)
  } finally {
    await repo.cleanup()
  }
})

test("commit patch line budgets omit later whole file records", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "a-lines.txt", "one\ntwo\nthree\n")
    await writeRepoFile(repo.path, "b-lines.txt", "four\nfive\nsix\n")
    await runFixtureGit(repo.path, ["add", "a-lines.txt", "b-lines.txt"])
    const canonical = await runFixtureGit(repo.path, [
      "-c",
      "core.quotepath=false",
      "diff",
      "--cached",
      "--patch",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--color=never",
      "--",
    ])
    const firstChunk = splitGitPatch(canonical).chunks[0]
    assert.ok(firstChunk)

    const input = await collectCommitDiffInput(createTrackingGitPi().pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      maxPatchLines: textLineCount(firstChunk),
    })

    assert.equal(input.includedFiles, 1)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.text.includes("diff --git a/a-lines.txt b/a-lines.txt"), true)
    assert.equal(input.text.includes("diff --git a/b-lines.txt b/b-lines.txt"), false)
    assert.equal(input.text.includes("2,000-line"), false)
    assert.equal(input.text.includes("line limit"), true)
  } finally {
    await repo.cleanup()
  }
})

test("rename pairs count as one staged budget unit", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "a-old.txt", "rename me\n")
    await runFixtureGit(repo.path, ["add", "a-old.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add rename source"])
    await runFixtureGit(repo.path, ["mv", "a-old.txt", "a-new.txt"])
    await writeRepoFile(repo.path, "z-added.txt", "added\n")
    await runFixtureGit(repo.path, ["add", "z-added.txt"])

    const input = await collectCommitDiffInput(createTrackingGitPi().pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      maxFiles: 1,
    })

    assert.equal(input.includedFiles, 1)
    assert.equal(input.omittedFiles, 1)
    assert.equal(input.text.includes("rename from a-old.txt"), true)
    assert.equal(input.text.includes("rename to a-new.txt"), true)
    assert.equal(input.text.includes('"z-added.txt"'), true)
  } finally {
    await repo.cleanup()
  }
})

test("the staged file budget bounds total object-size probes before enrichment", async () => {
  const repo = await createTempGitRepository()
  try {
    await stageUniqueFiles(repo.path, 20)
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path, {
      ...DEFAULT_COMMIT_PROMPT_BUDGET,
      maxFiles: 5,
    })

    assert.equal(input.includedFiles, 5)
    assert.equal(input.omittedFiles, 15)
    assert.equal(tracker.calls.filter((call) => call.args[0] === "cat-file").length <= 5, true)
  } finally {
    await repo.cleanup()
  }
})

test("staged object-size probes peak at four children", async () => {
  const repo = await createTempGitRepository()
  const paths = Array.from({ length: 10 }, (_, index) => `probe-${index}.txt`)
  try {
    await Promise.all(paths.map((path, index) => writeRepoFile(repo.path, path, `${index}-${"x".repeat(index)}\n`)))
    await runFixtureGit(repo.path, ["add", ...paths])
    const tracker = createTrackingGitPi()

    const input = await collectCommitDiffInput(tracker.pi, repo.path)

    assert.equal(input.includedFiles, 10)
    assert.equal(tracker.calls.filter((call) => call.args[0] === "cat-file").length, 10)
    assert.equal(tracker.peakActive(), DEFAULT_COMMIT_PROMPT_BUDGET.concurrency)
  } finally {
    await repo.cleanup()
  }
})
