import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import { discardFileChanges } from "../src/git-extras.js"
import { stageOrUnstageFile } from "../src/git-index-service.js"
import { GitExitError } from "../src/git-service.js"
import type { DiffFile } from "../src/types.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

function modifiedFile(path: string): DiffFile {
  return { path, status: "modified", staged: true, lines: [] }
}

function context(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext
}

test("discard rejects omitted entries before starting Git", async () => {
  const file = {
    ...modifiedFile("huge.txt"),
    omission: { reason: "file-too-large" as const, message: "Too large." },
  }

  await assert.rejects(
    () => discardFileChanges({} as never, "/repo", file),
    /Cannot discard huge\.txt because its diff was omitted/u,
  )
})

test("selected pathspec-magic filenames never stage or clean unrelated files", async () => {
  const repo = await createTempGitRepository()
  const magicPath = ":(glob)*.txt"
  try {
    await writeRepoFile(repo.path, magicPath, "literal path\n")
    await writeRepoFile(repo.path, "tracked.txt", "unrelated tracked change\n")
    const tracker = createTrackingGitPi()
    const selected: DiffFile = { path: magicPath, status: "added", staged: false, untracked: true, lines: [] }

    assert.equal(await stageOrUnstageFile(tracker.pi, repo.path, selected), `Staged ${magicPath}`)
    assert.deepEqual((await runFixtureGit(repo.path, ["diff", "--cached", "--name-only"])).trim(), magicPath)
    assert.match(await runFixtureGit(repo.path, ["diff", "--name-only"]), /^tracked\.txt$/mu)

    await runFixtureGit(repo.path, ["--literal-pathspecs", "reset", "--", magicPath])
    await writeRepoFile(repo.path, "other.txt", "must survive\n")
    assert.equal(await discardFileChanges(tracker.pi, repo.path, selected), `Removed untracked ${magicPath}`)
    await assert.rejects(() => readFile(`${repo.path}/${magicPath}`, "utf8"))
    assert.equal(await readFile(`${repo.path}/other.txt`, "utf8"), "must survive\n")
  } finally {
    await repo.cleanup()
  }
})

test("discard never treats a corrupt HEAD as an initial repository", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "dirty content\n")
    await writeRepoFile(repo.path, ".git/refs/heads/main", "not-an-object-id\n")
    const tracker = createTrackingGitPi()

    await assert.rejects(() => discardFileChanges(tracker.pi, repo.path, modifiedFile("tracked.txt")), GitExitError)

    assert.equal(await readFile(`${repo.path}/tracked.txt`, "utf8"), "dirty content\n")
    assert.equal(
      tracker.calls.some((call) => call.args[0] === "rm"),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("discarding a recreated staged deletion restores the original clean file", async () => {
  const repo = await createTempGitRepository()
  try {
    await runFixtureGit(repo.path, ["rm", "tracked.txt"])
    await writeRepoFile(repo.path, "tracked.txt", "recreated\n")
    const tracker = createTrackingGitPi()
    const document = await loadWorkingTreeDiff(tracker.pi, context(repo.path))
    const recreated = document.files.find(
      (file) => file.path === "tracked.txt" && file.status === "added" && file.untracked,
    )
    assert.ok(recreated)

    assert.equal(await discardFileChanges(tracker.pi, repo.path, recreated), "Discarded changes in tracked.txt")

    assert.equal(await readFile(`${repo.path}/tracked.txt`, "utf8"), "initial\n")
    assert.equal((await runFixtureGit(repo.path, ["status", "--short"])).trim(), "")
  } finally {
    await repo.cleanup()
  }
})

test("discard still removes a staged file from an actual initial repository", async () => {
  const repo = await createTempGitRepository(false)
  try {
    await writeRepoFile(repo.path, "staged.txt", "staged\n")
    await runFixtureGit(repo.path, ["add", "staged.txt"])

    const message = await discardFileChanges(createTrackingGitPi().pi, repo.path, modifiedFile("staged.txt"))

    assert.equal(message, "Discarded changes in staged.txt")
    await assert.rejects(() => readFile(`${repo.path}/staged.txt`, "utf8"))
  } finally {
    await repo.cleanup()
  }
})
