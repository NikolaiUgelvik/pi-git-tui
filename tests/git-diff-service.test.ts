import assert from "node:assert/strict"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { collectCommitDiffInput } from "../src/commit-diff-input.js"
import { loadCommitDiff, loadWorkingTreeDiff } from "../src/git-diff-service.js"
import { discardFileChanges } from "../src/git-extras.js"
import { stageOrUnstageFile } from "../src/git-index-service.js"
import { GitAbortError, GitExitError } from "../src/git-service.js"
import { loadWorkingTreeSnapshot } from "../src/git-status.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

type RawGitResult = { stdout: string; stderr: string; code: number; killed: boolean }

const statusCommand = "status --porcelain=v2 --branch -z --untracked-files=all --ignore-submodules=none --find-renames"

function context(cwd: string, signal = new AbortController().signal): ExtensionContext {
  return { cwd, signal } as ExtensionContext
}

function rawResult(stdout = "", code = 0, stderr = "", killed = false): RawGitResult {
  return { stdout, stderr, code, killed }
}

function attachedStatus(records: string[] = []): string {
  return [`# branch.oid ${"a".repeat(40)}`, "# branch.head main", ...records, ""].join("\0")
}

function untrackedPipelinePrelude(
  args: readonly string[],
  root: string,
  statusRecords: readonly string[],
): RawGitResult | undefined {
  if (args.join(" ") === "rev-parse --show-toplevel") return rawResult(`${root}\n`)
  if (args[0] === "status") return rawResult(attachedStatus([...statusRecords]))
  if (args.includes("--quiet") && args.includes("diff")) return rawResult()
  if (args.includes("ls-files") || args.includes("ls-tree")) return rawResult()
}

function resultAfterAbort(signal: AbortSignal | undefined, onAbort: () => void = () => {}): Promise<RawGitResult> {
  return new Promise((resolve) => {
    signal?.addEventListener(
      "abort",
      () => {
        onAbort()
        resolve(rawResult("partial", 0, "", true))
      },
      { once: true },
    )
  })
}

test("a clean working-tree load uses exactly root, status, and tracked-diff processes", async () => {
  const repo = await createTempGitRepository()
  try {
    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))

    assert.equal(document.title, "Working tree vs HEAD")
    assert.equal(document.subtitle, `${repo.path} (main)`)
    assert.equal(document.raw, "")
    assert.deepEqual(document.files, [])
    assert.equal(tracker.calls.length, 3)
    assert.deepEqual(
      tracker.calls.slice(0, 2).map((call) => call.args.join(" ")),
      ["rev-parse --show-toplevel", statusCommand],
    )
    assert.match(tracker.calls[2]?.args.join(" ") ?? "", /^diff --quiet [0-9a-f]{40,64} --$/u)
    assert.equal(tracker.peakActive(), 1)
  } finally {
    await repo.cleanup()
  }
})

test("a clean initial repository also uses exactly three fixed processes", async () => {
  const repo = await createTempGitRepository(false)
  try {
    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))

    assert.equal(document.title, "Working tree (no commits yet)")
    assert.equal(tracker.calls.length, 3)
    assert.deepEqual(
      tracker.calls.map((call) => call.args[0]),
      ["rev-parse", "status", "diff"],
    )
  } finally {
    await repo.cleanup()
  }
})

test("working documents remain equivalent for staged, unstaged, renamed, and unusual untracked paths", async () => {
  const repo = await createTempGitRepository()
  const unusualUntracked = "space λ\tline\nname.txt"
  try {
    await writeRepoFile(repo.path, "staged.txt", "before\n")
    await writeRepoFile(repo.path, "old name.txt", "rename me\n")
    await runFixtureGit(repo.path, ["add", "staged.txt", "old name.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add fixtures"])
    await writeRepoFile(repo.path, "tracked.txt", "unstaged change\n")
    await writeRepoFile(repo.path, "staged.txt", "staged change\n")
    await runFixtureGit(repo.path, ["add", "staged.txt"])
    await runFixtureGit(repo.path, ["mv", "old name.txt", "renamed name.txt"])
    await writeRepoFile(repo.path, unusualUntracked, "untracked\n")

    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const byPath = new Map(document.files.map((file) => [file.path, file]))

    assert.equal(byPath.get("tracked.txt")?.staged, false)
    assert.equal(byPath.get("staged.txt")?.staged, true)
    assert.equal(byPath.get("renamed name.txt")?.status, "renamed")
    assert.equal(byPath.get("renamed name.txt")?.staged, true)
    assert.equal(byPath.get(unusualUntracked)?.status, "added")
    assert.equal(byPath.get(unusualUntracked)?.untracked, true)
    assert.equal(tracker.calls.filter((call) => call.args[0] === "status").length, 1)
    assert.equal(
      tracker.calls.some(
        (call) => ["branch", "rev-list"].includes(call.args[0] ?? "") || call.args.includes("--diff-filter=U"),
      ),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("historical capture preserves root and first-parent commit patches", async () => {
  const repo = await createTempGitRepository()
  try {
    const rootHash = (await runFixtureGit(repo.path, ["rev-list", "--max-parents=0", "HEAD"])).trim()
    const rootDocument = await loadCommitDiff(createTrackingGitPi().pi, repo.path, {
      hash: rootHash,
      message: "initial",
    })
    assert.equal(rootDocument.files.find((file) => file.path === "tracked.txt")?.status, "added")
    assert.match(rootDocument.raw, /^\+initial$/mu)

    await writeRepoFile(repo.path, "tracked.txt", "second\n")
    await runFixtureGit(repo.path, ["commit", "-am", "second"])
    const secondHash = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()
    const secondDocument = await loadCommitDiff(createTrackingGitPi().pi, repo.path, {
      hash: secondHash,
      message: "second",
    })
    assert.match(secondDocument.raw, /^-initial$/mu)
    assert.match(secondDocument.raw, /^\+second$/mu)
    assert.equal(secondDocument.omittedFileCount, 0)
  } finally {
    await repo.cleanup()
  }
})

test("historical commits omit oversized files before patch capture", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "historical-large.txt", "x".repeat(3 * 1024 * 1024))
    await runFixtureGit(repo.path, ["add", "historical-large.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add historical large file"])
    const hash = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()
    const tracker = createTrackingGitPi()

    const document = await loadCommitDiff(
      tracker.pi,
      repo.path,
      { hash, message: "add historical large file" },
      new AbortController().signal,
    )

    assert.equal(document.raw, "")
    assert.equal(document.omittedFileCount, 1)
    assert.equal(document.files[0]?.path, "historical-large.txt")
    assert.equal(document.files[0]?.omission?.reason, "file-too-large")
    assert.equal(
      tracker.calls.some((call) => call.args.includes("-p") || call.args.includes("--patch")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("tracked omissions retain canonical status ordering among captured files", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "a-large.txt", "before\n")
    await writeRepoFile(repo.path, "b-small.txt", "before\n")
    await runFixtureGit(repo.path, ["add", "a-large.txt", "b-small.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add ordering fixtures"])
    await writeRepoFile(repo.path, "a-large.txt", "x".repeat(3 * 1024 * 1024))
    await writeRepoFile(repo.path, "b-small.txt", "after\n")

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assert.deepEqual(
      document.files.map((file) => file.path),
      ["a-large.txt", "b-small.txt"],
    )
    assert.equal(document.files[0]?.omission?.reason, "file-too-large")
    assert.equal(document.files[1]?.omission, undefined)
  } finally {
    await repo.cleanup()
  }
})

test("real repository diffs preserve C-quoted control characters and backslashes", async () => {
  const repo = await createTempGitRepository()
  const paths = ["bell\u0007-name.txt", "vertical\u000b-name.txt", "backslash\\name.txt"]
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "before\n")))
    await runFixtureGit(repo.path, ["add", ...paths])
    await runFixtureGit(repo.path, ["commit", "-m", "add quoted paths"])
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "after\n")))

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assert.deepEqual(document.files.map((file) => file.path).sort(), [...paths].sort())
    assert.equal(
      document.files.every((file) => file.omission === undefined),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("non-UTF-8 byte paths fail closed as non-actionable omissions", async (testContext) => {
  if (process.platform === "win32") {
    testContext.skip("Windows filenames are Unicode rather than arbitrary byte sequences")
    return
  }
  const repo = await createTempGitRepository()
  const bytePath = Buffer.concat([Buffer.from(`${repo.path}/invalid-`), Buffer.from([0xff]), Buffer.from(".txt")])
  try {
    await writeFile(bytePath, "before\n")
    await runFixtureGit(repo.path, ["add", "--all"])
    await runFixtureGit(repo.path, ["commit", "-m", "add byte path"])
    await writeFile(bytePath, "after\n")

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const byteEntries = document.files.filter((file) => file.path.includes("invalid-"))

    assert.equal(byteEntries.length, 1)
    assert.equal(byteEntries[0]?.omission?.reason, "unsupported-file")
    assert.equal(byteEntries[0]?.lines.length, 0)
  } finally {
    await repo.cleanup()
  }
})

test("staged deletion followed by recreation retains both tracked and untracked changes", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["rm", "tracked.txt"])
    await writeRepoFile(repo.path, "tracked.txt", "recreated\n")

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const matching = document.files.filter((file) => file.path === "tracked.txt")

    assert.equal(matching.length, 2)
    assert.deepEqual(
      matching.map((file) => file.status),
      ["deleted", "added"],
    )
    assert.equal(matching[1]?.untracked, true)
    assert.equal(
      matching[1]?.lines.some((line) => line === "+recreated"),
      true,
    )
    const recreated = matching[1]
    assert.ok(recreated)
    assert.equal(await stageOrUnstageFile(createTrackingGitPi().pi, repo.path, recreated), "Staged tracked.txt")
    assert.match(await runFixtureGit(repo.path, ["status", "--short"]), /^M {2}tracked\.txt$/mu)
  } finally {
    await repo.cleanup()
  }
})

test("staged rename followed by source recreation retains the recreated source patch", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["mv", "tracked.txt", "moved.txt"])
    await writeRepoFile(repo.path, "tracked.txt", "recreated source\n")

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))

    assert.equal(document.files.find((file) => file.path === "moved.txt")?.status, "renamed")
    const recreated = document.files.find((file) => file.path === "tracked.txt" && file.untracked)
    assert.equal(recreated?.status, "added")
    assert.equal(
      recreated?.lines.some((line) => line === "+recreated source"),
      true,
    )
  } finally {
    await repo.cleanup()
  }
})

test("real dirty submodule state is retained in the status snapshot", async () => {
  const repo = await createTempGitRepository()
  const child = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      child.path,
      "vendor/module",
    ])
    await runFixtureGit(repo.path, ["commit", "-am", "add submodule"])
    await writeRepoFile(repo.path, "vendor/module/tracked.txt", "dirty submodule\n")

    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    const entry = snapshot.entries.find((candidate) => candidate.path === "vendor/module")

    assert.equal(entry?.kind, "ordinary")
    assert.equal(entry?.worktreeStatus, "M")
    assert.equal(entry?.submodule, "S.M.")

    await runFixtureGit(repo.path, ["config", "diff.ignoreSubmodules", "all"])
    const tracker = createTrackingGitPi()
    const ignoredDocument = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const submodule = ignoredDocument.files.find((file) => file.path === "vendor/module")
    assert.equal(submodule?.omission, undefined)
    assert.equal(submodule?.submodule, "S.M.")
    assert.equal(
      submodule?.lines.some((line) => line.startsWith("+Subproject commit ") && line.endsWith("-dirty")),
      true,
    )
    assert.equal(
      tracker.calls
        .filter((call) => call.args.includes("diff") && !call.args.includes("--quiet"))
        .every((call) => call.args.includes("--ignore-submodules=none")),
      true,
    )
    assert.ok(submodule)
    const callsBeforeActions = tracker.calls.length
    await assert.rejects(
      () => stageOrUnstageFile(tracker.pi, repo.path, submodule),
      /manage nested changes inside the submodule/u,
    )
    await assert.rejects(
      () => discardFileChanges(tracker.pi, repo.path, submodule),
      /manage nested changes inside the submodule/u,
    )
    assert.equal(
      tracker.calls
        .slice(callsBeforeActions)
        .some((call) => ["add", "restore", "reset", "clean"].includes(call.args[0] ?? "")),
      false,
    )
  } finally {
    await repo.cleanup()
    await child.cleanup()
  }
})

test("clean submodule pointer updates can be staged and unstaged", async () => {
  const repo = await createTempGitRepository()
  const child = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      child.path,
      "vendor/module",
    ])
    await runFixtureGit(repo.path, ["commit", "-am", "add submodule"])
    const nested = join(repo.path, "vendor/module")
    await runFixtureGit(nested, ["config", "user.name", "Pi Git Tests"])
    await runFixtureGit(nested, ["config", "user.email", "pi-git@example.invalid"])
    await writeRepoFile(repo.path, "vendor/module/tracked.txt", "clean pointer update\n")
    await runFixtureGit(nested, ["commit", "-am", "advance submodule"])

    const unstagedDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const unstaged = unstagedDocument.files.find((file) => file.path === "vendor/module")
    assert.ok(unstaged)
    assert.equal(unstaged.staged, false)
    assert.equal(unstaged.submodule, "SC..")
    assert.equal(await stageOrUnstageFile(createTrackingGitPi().pi, repo.path, unstaged), "Staged vendor/module")

    const stagedDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const staged = stagedDocument.files.find((file) => file.path === "vendor/module")
    assert.ok(staged)
    assert.equal(staged.staged, true)
    assert.equal(staged.submodule, "S...")
    assert.equal(await stageOrUnstageFile(createTrackingGitPi().pi, repo.path, staged), "Unstaged vendor/module")
    assert.match(await runFixtureGit(repo.path, ["status", "--short"]), /^ M vendor\/module$/mu)
  } finally {
    await repo.cleanup()
    await child.cleanup()
  }
})

test("an initial repository uses the no-HEAD diff and preserves staged and untracked state", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await writeRepoFile(repo.path, "staged.txt", "staged\n")
    await writeRepoFile(repo.path, "untracked.txt", "untracked\n")
    await runFixtureGit(repo.path, ["add", "staged.txt"])

    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const byPath = new Map(document.files.map((file) => [file.path, file]))

    assert.equal(document.title, "Working tree (no commits yet)")
    assert.equal(document.subtitle, `${repo.path} (main)`)
    assert.equal(byPath.get("staged.txt")?.staged, true)
    assert.equal(byPath.get("untracked.txt")?.untracked, true)
    assert.ok(
      tracker.calls.some(
        (call) =>
          call.args.includes("diff") &&
          call.args.includes("--cached") &&
          call.args.includes("--literal-pathspecs") &&
          call.args.at(-1) === "staged.txt",
      ),
    )
  } finally {
    await repo.cleanup()
  }
})

test("SHA-256 repositories support initial, staged, tracked, and detached capture", async (testContext) => {
  let repo: Awaited<ReturnType<typeof createTempGitRepository>>
  try {
    repo = await createTempGitRepository(false, "sha256")
  } catch {
    testContext.skip("installed Git does not support SHA-256 repositories")
    return
  }
  try {
    await writeRepoFile(repo.path, "sha256.txt", "initial staged\n")
    await runFixtureGit(repo.path, ["add", "sha256.txt"])
    const initial = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(initial.files.find((file) => file.path === "sha256.txt")?.staged, true)
    assert.equal((await collectCommitDiffInput(createTrackingGitPi().pi, repo.path)).includedFiles, 1)

    await runFixtureGit(repo.path, ["commit", "-m", "sha256 initial"])
    const snapshot = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    assert.equal(snapshot.head.kind === "attached" ? snapshot.head.oid.length : 0, 64)
    await writeRepoFile(repo.path, "sha256.txt", "tracked change\n")
    const tracked = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(tracked.files.find((file) => file.path === "sha256.txt")?.omission, undefined)

    await runFixtureGit(repo.path, ["restore", "sha256.txt"])
    await runFixtureGit(repo.path, ["switch", "--detach", "HEAD"])
    const detached = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    assert.equal(detached.head.kind === "detached" ? detached.head.oid.length : 0, 64)
  } finally {
    await repo.cleanup()
  }
})

test("branches literally named (detached) are distinguished from detached HEAD", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await runFixtureGit(repo.path, ["branch", "-m", "(detached)"])
    const initial = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    assert.deepEqual(initial.head, { kind: "initial", branch: "(detached)" })

    await writeRepoFile(repo.path, "tracked.txt", "tracked\n")
    await runFixtureGit(repo.path, ["add", "tracked.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "initial"])
    const attached = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    assert.equal(attached.head.kind, "attached")
    if (attached.head.kind === "attached") {
      assert.equal(attached.head.branch, "(detached)")
    }

    await runFixtureGit(repo.path, ["switch", "--detach", "HEAD"])
    const detached = await loadWorkingTreeSnapshot(createTrackingGitPi().pi, repo.path)
    assert.equal(detached.head.kind, "detached")
  } finally {
    await repo.cleanup()
  }
})

test("upstream counts and detached HEAD labels come from porcelain-v2 metadata", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["branch", "upstream"])
    await runFixtureGit(repo.path, ["branch", "--set-upstream-to=upstream", "main"])
    await writeRepoFile(repo.path, "ahead.txt", "ahead\n")
    await runFixtureGit(repo.path, ["add", "ahead.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "ahead"])

    const attached = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(attached.subtitle, `${repo.path} (main ↑1)`)

    const oid = (await runFixtureGit(repo.path, ["rev-parse", "HEAD"])).trim()
    await runFixtureGit(repo.path, ["switch", "--detach", "HEAD"])
    const detached = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(detached.subtitle, `${repo.path} (detached ${oid.slice(0, 7)})`)
  } finally {
    await repo.cleanup()
  }
})

test("conflicted files stay explicitly unmerged until the user stages a resolution", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["switch", "-c", "side"])
    await writeRepoFile(repo.path, "tracked.txt", "side\n")
    await runFixtureGit(repo.path, ["commit", "-am", "side"])
    await runFixtureGit(repo.path, ["switch", "main"])
    await writeRepoFile(repo.path, "tracked.txt", "main\n")
    await runFixtureGit(repo.path, ["commit", "-am", "main"])
    await assert.rejects(() => runFixtureGit(repo.path, ["merge", "side"]))

    const document = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const conflict = document.files.find((file) => file.path === "tracked.txt")

    assert.equal(conflict?.status, "conflicted")
    assert.equal(conflict?.staged, false)
    assert.notEqual((await runFixtureGit(repo.path, ["ls-files", "--unmerged", "--", "tracked.txt"])).trim(), "")

    const tracker = createTrackingGitPi()
    assert.equal(await stageOrUnstageFile(tracker.pi, repo.path, "tracked.txt"), "Staged tracked.txt")
    assert.equal((await runFixtureGit(repo.path, ["ls-files", "--unmerged", "--", "tracked.txt"])).trim(), "")
    assert.equal(
      tracker.calls.some((call) => call.args.join(" ") === "--literal-pathspecs add -- tracked.txt"),
      true,
    )
    assert.equal(
      tracker.calls.some((call) => call.args.includes("restore") || call.args.includes("reset")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("linked worktrees use their own root and branch metadata", async () => {
  const repo = await createTempGitRepository()
  const linkedPath = `${repo.path}-linked`
  try {
    await runFixtureGit(repo.path, ["branch", "feature"])
    await runFixtureGit(repo.path, ["worktree", "add", linkedPath, "feature"])
    await writeRepoFile(linkedPath, "nested/.keep", "nested\n")

    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(join(linkedPath, "nested")))

    assert.equal(document.subtitle, `${linkedPath} (feature)`)
    assert.equal(tracker.calls[1]?.cwd, linkedPath)
    assert.equal(tracker.calls[1]?.args.join(" "), statusCommand)
  } finally {
    await rm(linkedPath, { recursive: true, force: true })
    await repo.cleanup()
  }
})

test("cancellation during status is terminal and starts no later phase", async () => {
  const controller = new AbortController()
  const calls: Array<{ args: string[]; startedAborted: boolean }> = []
  const pi = {
    exec: async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
      calls.push({ args, startedAborted: options?.signal?.aborted ?? false })
      if (args.join(" ") === "rev-parse --show-toplevel") return rawResult("/repo\n")
      controller.abort()
      return rawResult("partial status", 0, "", true)
    },
  } as unknown as ExtensionAPI

  await assert.rejects(() => loadWorkingTreeDiff(pi, context("/repo", controller.signal)), GitAbortError)
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["rev-parse", "status"],
  )
  assert.equal(
    calls.some((call) => call.startedAborted),
    false,
  )
})

test("cancellation during untracked loading starts no Git calls after abort", async () => {
  const repo = await createTempGitRepository()
  const controller = new AbortController()
  const paths = Array.from({ length: 50 }, (_, index) => `file-${index}.txt`)
  try {
    await Promise.all(paths.map((path) => writeRepoFile(repo.path, path, "content\n")))
    const calls: Array<{ args: string[]; startedAborted: boolean }> = []
    let diffsStarted = 0
    const pi = {
      exec: async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
        calls.push({ args, startedAborted: options?.signal?.aborted ?? false })
        const prelude = untrackedPipelinePrelude(
          args,
          repo.path,
          paths.map((path) => `? ${path}`),
        )
        if (prelude) return prelude
        if (!args.includes("--no-index")) return rawResult("", 2, `unexpected ${args.join(" ")}`)
        diffsStarted++
        if (diffsStarted === 4) queueMicrotask(() => controller.abort())
        return resultAfterAbort(options?.signal)
      },
    } as unknown as ExtensionAPI

    await assert.rejects(() => loadWorkingTreeDiff(pi, context(repo.path, controller.signal)), GitAbortError)
    assert.equal(diffsStarted, 4)
    assert.equal(
      calls.some((call) => call.startedAborted),
      false,
    )
    assert.equal(calls.filter((call) => call.args.includes("--no-index")).length, 4)
  } finally {
    await repo.cleanup()
  }
})

test("a terminal worker failure aborts and awaits the other active workers", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "first.txt", "first\n")
    await writeRepoFile(repo.path, "second.txt", "second\n")
    let peerSettled = false
    let diffIndex = 0
    const pi = {
      exec: async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
        const prelude = untrackedPipelinePrelude(args, repo.path, ["? first.txt", "? second.txt"])
        if (prelude) return prelude
        if (!args.includes("--no-index")) return rawResult("", 2, `unexpected ${args.join(" ")}`)
        diffIndex++
        if (diffIndex === 1) return rawResult("", 2, "diff failed")
        return resultAfterAbort(options?.signal, () => {
          peerSettled = true
        })
      },
    } as unknown as ExtensionAPI

    await assert.rejects(
      () => loadWorkingTreeDiff(pi, context(repo.path)),
      (error: unknown) => error instanceof GitExitError && error.result.code === 2,
    )
    assert.equal(peerSettled, true)
  } finally {
    await repo.cleanup()
  }
})
