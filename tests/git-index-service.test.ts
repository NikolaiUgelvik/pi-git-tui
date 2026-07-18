import assert from "node:assert/strict"
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDocument } from "../src/git-diff-service.js"
import { stageAllRemaining, stageRemainingFile, unstageAll, unstageFile } from "../src/git-index-service.js"
import { realGitPi, runGit } from "./helpers/real-git.js"

async function initializeRepository(root: string): Promise<void> {
  runGit(root, ["init", "--quiet", "--initial-branch=main"])
  runGit(root, ["config", "user.email", "tests@example.com"])
  runGit(root, ["config", "user.name", "Tests"])
  await writeFile(join(root, "file.txt"), "base one\nbase two\n")
  runGit(root, ["add", "--all"])
  runGit(root, ["commit", "--quiet", "-m", "initial"])
}

test("staging a mixed file stages the remaining content instead of unstaging it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-stage-mixed-"))
  try {
    await initializeRepository(root)
    await writeFile(join(root, "file.txt"), "staged one\nbase two\n")
    runGit(root, ["add", "file.txt"])
    await writeFile(join(root, "file.txt"), "staged one\nworking two\n")

    await stageRemainingFile(realGitPi(), root, "file.txt")

    assert.equal(runGit(root, ["diff", "--", "file.txt"]), "")
    const staged = runGit(root, ["diff", "--cached", "--", "file.txt"])
    assert.match(staged, /\+staged one/u)
    assert.match(staged, /\+working two/u)
    const stagedDocument = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
    assert.deepEqual(stagedDocument.staged.stats, { files: 1, additions: 2, deletions: 2 })
    assert.deepEqual(stagedDocument.working.stats, { files: 0, additions: 0, deletions: 0 })

    await unstageFile(realGitPi(), root, "file.txt")
    const unstagedDocument = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
    assert.deepEqual(unstagedDocument.staged.stats, { files: 0, additions: 0, deletions: 0 })
    assert.deepEqual(unstagedDocument.working.stats, { files: 1, additions: 2, deletions: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("explicit unstage preserves working-tree edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-unstage-file-"))
  try {
    await initializeRepository(root)
    await writeFile(join(root, "file.txt"), "changed\n")
    runGit(root, ["add", "file.txt"])

    await unstageFile(realGitPi(), root, "file.txt")

    assert.equal(runGit(root, ["diff", "--cached", "--", "file.txt"]), "")
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "changed\n")
    assert.match(runGit(root, ["diff", "--", "file.txt"]), /\+changed/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("unborn-HEAD unstage fallback preserves newer working content", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-unstage-unborn-"))
  try {
    runGit(root, ["init", "--quiet", "--initial-branch=main"])
    await writeFile(join(root, "first.txt"), "staged\n")
    runGit(root, ["add", "first.txt"])
    await writeFile(join(root, "first.txt"), "working\n")

    await unstageFile(realGitPi(), root, "first.txt")

    assert.equal(runGit(root, ["ls-files", "--stage", "--", "first.txt"]), "")
    assert.equal(await readFile(join(root, "first.txt"), "utf8"), "working\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("stage-all and unstage-all are deterministic in an unborn repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-all-"))
  try {
    runGit(root, ["init", "--quiet", "--initial-branch=main"])
    await writeFile(join(root, "one.txt"), "one\n")
    await writeFile(join(root, "two.txt"), "two\n")

    await stageAllRemaining(realGitPi(), root)
    assert.deepEqual(runGit(root, ["ls-files"]).trim().split("\n"), ["one.txt", "two.txt"])

    await unstageAll(realGitPi(), root)
    assert.equal(runGit(root, ["ls-files"]), "")
    assert.equal(await readFile(join(root, "one.txt"), "utf8"), "one\n")
    assert.equal(await readFile(join(root, "two.txt"), "utf8"), "two\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rename aliases stage and unstage the full logical rename", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-rename-"))
  try {
    await initializeRepository(root)
    await rename(join(root, "file.txt"), join(root, "renamed.txt"))
    await writeFile(join(root, "renamed.txt"), "renamed content\n")
    runGit(root, ["add", "-N", "renamed.txt"])

    await stageRemainingFile(realGitPi(), root, ["renamed.txt", "file.txt"])
    assert.equal(runGit(root, ["diff", "--", "file.txt", "renamed.txt"]), "")
    assert.deepEqual(runGit(root, ["diff", "--cached", "--name-only"]).trim().split("\n").sort(), [
      "file.txt",
      "renamed.txt",
    ])

    await unstageFile(realGitPi(), root, ["file.txt", "renamed.txt"])
    assert.equal(runGit(root, ["diff", "--cached", "--name-status"]), "")
    assert.match(runGit(root, ["status", "--short"]), / D file\.txt[\s\S]*\?\? renamed\.txt/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
