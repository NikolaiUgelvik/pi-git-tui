import assert from "node:assert/strict"
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { diffFileAliases } from "../src/diff-document.js"
import { loadWorkingTreeDocument } from "../src/git-diff-service.js"
import { discardFileChanges } from "../src/git-extras.js"
import { realGitPi, runGit } from "./helpers/real-git.js"

async function initializeRepository(root: string, contents = "base\n"): Promise<void> {
  runGit(root, ["init", "--quiet", "--initial-branch=main"])
  runGit(root, ["config", "user.email", "tests@example.com"])
  runGit(root, ["config", "user.name", "Tests"])
  await writeFile(join(root, "old.txt"), contents)
  runGit(root, ["add", "--all"])
  runGit(root, ["commit", "--quiet", "-m", "initial"])
}

async function mixedRenameSelection(root: string) {
  await rename(join(root, "old.txt"), join(root, "new.txt"))
  runGit(root, ["add", "--all"])
  await writeFile(join(root, "new.txt"), "changed after staging\n")
  const document = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
  const selected = document.working.files[0]
  assert.ok(selected)
  assert.equal(selected.status, "modified")
  assert.deepEqual(diffFileAliases(selected).sort(), ["new.txt", "old.txt"])
  return selected
}

test("discarding a mixed staged rename restores both logical paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-discard-rename-"))
  try {
    await initializeRepository(root)
    const selected = await mixedRenameSelection(root)

    await discardFileChanges(realGitPi(), root, selected)

    assert.equal(runGit(root, ["status", "--short"]), "")
    assert.equal(await readFile(join(root, "old.txt"), "utf8"), "base\n")
    await assert.rejects(() => readFile(join(root, "new.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("discarding a detected copy preserves independent source edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-discard-copy-"))
  try {
    const base = Array.from({ length: 10 }, (_value, index) => `line ${index}\n`).join("")
    const stagedSource = `${base}staged source line\n`
    const workingSource = `${stagedSource}independent working line\n`
    await initializeRepository(root, base)
    await writeFile(join(root, "old.txt"), stagedSource)
    runGit(root, ["add", "old.txt"])
    await writeFile(join(root, "copy.txt"), stagedSource)
    runGit(root, ["add", "copy.txt"])
    await writeFile(join(root, "old.txt"), workingSource)
    const document = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
    const selected = document.staged.files.find((file) => file.path === "copy.txt")
    assert.ok(selected)
    assert.equal(selected.status, "copied")

    await discardFileChanges(realGitPi(), root, selected)

    assert.equal(runGit(root, ["status", "--short"]), "MM old.txt\n")
    assert.equal(await readFile(join(root, "old.txt"), "utf8"), workingSource)
    await assert.rejects(() => readFile(join(root, "copy.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("discarding a stale rename snapshot reclassifies every alias against current HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-discard-stale-rename-"))
  try {
    await initializeRepository(root)
    const staleSelection = await mixedRenameSelection(root)
    runGit(root, ["commit", "--quiet", "-m", "rename file"])
    await writeFile(join(root, "new.txt"), "newer working edit\n")
    await writeFile(join(root, "old.txt"), "untracked stale alias\n")

    await discardFileChanges(realGitPi(), root, staleSelection)

    assert.equal(runGit(root, ["status", "--short"]), "")
    assert.equal(await readFile(join(root, "new.txt"), "utf8"), "base\n")
    await assert.rejects(() => readFile(join(root, "old.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
