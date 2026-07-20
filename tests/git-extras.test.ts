import assert from "node:assert/strict"
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { diffFileAliases } from "../src/diff-document.js"
import { loadWorkingTreeDocument } from "../src/git-diff-service.js"
import { discardFileChanges } from "../src/git-extras.js"
import { stageRemainingFile, unstageFile } from "../src/git-index-service.js"
import type { DiffFile } from "../src/types.js"
import { realGitPi, runRealGit } from "./helpers/real-git.js"

async function initializeRepository(root: string, contents = "base\n"): Promise<void> {
  runRealGit(root, ["init", "--quiet", "--initial-branch=main"])
  runRealGit(root, ["config", "user.email", "tests@example.com"])
  runRealGit(root, ["config", "user.name", "Tests"])
  await writeFile(join(root, "old.txt"), contents)
  runRealGit(root, ["add", "--all"])
  runRealGit(root, ["commit", "--quiet", "-m", "initial"])
}

async function mixedRenameSelection(root: string) {
  await rename(join(root, "old.txt"), join(root, "new.txt"))
  runRealGit(root, ["add", "--all"])
  await writeFile(join(root, "new.txt"), "changed after staging\n")
  const document = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
  const selected = document.working.files[0]
  assert.ok(selected)
  assert.equal(selected.status, "modified")
  assert.deepEqual(diffFileAliases(selected).sort(), ["new.txt", "old.txt"])
  return selected
}

test("discard rejects omitted entries before starting Git", async () => {
  const file: DiffFile = {
    path: "huge.txt",
    status: "modified",
    lines: [],
    omission: { reason: "file-too-large", message: "Too large." },
  }

  await assert.rejects(
    () => discardFileChanges({} as never, "/repo", file),
    /Cannot discard huge\.txt because its diff was omitted/u,
  )
})

test("selected pathspec-magic filenames never stage or clean unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-literal-path-"))
  const magicPath = ":(glob)*.txt"
  try {
    await initializeRepository(root)
    await writeFile(join(root, "tracked.txt"), "base\n")
    runRealGit(root, ["add", "tracked.txt"])
    runRealGit(root, ["commit", "--quiet", "-m", "add tracked fixture"])
    await writeFile(join(root, magicPath), "literal path\n")
    await writeFile(join(root, "tracked.txt"), "unrelated tracked change\n")
    const selected: DiffFile = { path: magicPath, status: "added", untracked: true, lines: [] }

    assert.equal(await stageRemainingFile(realGitPi(), root, selected), `Staged remaining changes in ${magicPath}`)
    assert.deepEqual(runRealGit(root, ["diff", "--cached", "--name-only"]).trim(), magicPath)
    assert.match(runRealGit(root, ["diff", "--name-only"]), /^tracked\.txt$/mu)

    assert.equal(await unstageFile(realGitPi(), root, selected), `Unstaged ${magicPath}`)
    await writeFile(join(root, "other.txt"), "must survive\n")
    assert.equal(await discardFileChanges(realGitPi(), root, selected), `Discarded changes in ${magicPath}`)
    await assert.rejects(() => readFile(join(root, magicPath), "utf8"), { code: "ENOENT" })
    assert.equal(await readFile(join(root, "other.txt"), "utf8"), "must survive\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("discarding a mixed staged rename restores both logical paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-discard-rename-"))
  try {
    await initializeRepository(root)
    const selected = await mixedRenameSelection(root)

    await discardFileChanges(realGitPi(), root, selected)

    assert.equal(runRealGit(root, ["status", "--short"]), "")
    assert.equal(await readFile(join(root, "old.txt"), "utf8"), "base\n")
    await assert.rejects(() => readFile(join(root, "new.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("discarding a detected copy preserves independent source edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-discard-copy-"))
  try {
    const base = Array.from({ length: 10 }, (_value, index) => `line ${index}\n`).join("")
    const stagedSource = `${base}staged source line\n`
    const workingSource = `${stagedSource}independent working line\n`
    await initializeRepository(root, base)
    await writeFile(join(root, "old.txt"), stagedSource)
    runRealGit(root, ["add", "old.txt"])
    await writeFile(join(root, "copy.txt"), stagedSource)
    runRealGit(root, ["add", "copy.txt"])
    await writeFile(join(root, "old.txt"), workingSource)
    const document = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
    const selected = document.staged.files.find((file) => file.path === "copy.txt")
    assert.ok(selected)
    assert.equal(selected.status, "copied")

    await discardFileChanges(realGitPi(), root, selected)

    assert.equal(runRealGit(root, ["status", "--short"]), "MM old.txt\n")
    assert.equal(await readFile(join(root, "old.txt"), "utf8"), workingSource)
    await assert.rejects(() => readFile(join(root, "copy.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("discarding a stale rename snapshot reclassifies every alias against current HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-discard-stale-rename-"))
  try {
    await initializeRepository(root)
    const staleSelection = await mixedRenameSelection(root)
    runRealGit(root, ["commit", "--quiet", "-m", "rename file"])
    await writeFile(join(root, "new.txt"), "newer working edit\n")
    await writeFile(join(root, "old.txt"), "untracked stale alias\n")

    await discardFileChanges(realGitPi(), root, staleSelection)

    assert.equal(runRealGit(root, ["status", "--short"]), "")
    assert.equal(await readFile(join(root, "new.txt"), "utf8"), "base\n")
    await assert.rejects(() => readFile(join(root, "old.txt"), "utf8"), { code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
