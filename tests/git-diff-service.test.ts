import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadCommitDocument, loadWorkingTreeDocument } from "../src/git-diff-service.js"
import { discardFileChanges } from "../src/git-extras.js"
import { stageAllRemaining, stageRemainingFile, unstageFile } from "../src/git-index-service.js"
import { GitCommandError, GitTimeoutError } from "../src/git-service.js"
import { type GitExecResult, MAX_UNTRACKED_FILE_BYTES } from "../src/types.js"
import { realGitPi, runRealGit } from "./helpers/real-git.js"
import { workingSnapshotResult } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }
type Handler = (args: string[], options?: ExecOptions) => GitExecResult | Promise<GitExecResult>

function gitResult(stdout = "", code = 0, stderr = "", killed = false): GitExecResult {
  return { stdout, stderr, code, killed }
}

function createPi(handler: Handler): ExtensionAPI {
  return {
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      assert.equal(command, "git")
      return handler(args, options)
    },
  } as unknown as ExtensionAPI
}

function commandKey(args: string[]): string {
  return args.join(" ")
}

function snapshotPi(overrides: Record<string, GitExecResult> = {}, root = "/repo"): ExtensionAPI {
  return createPi((args) => {
    const command = commandKey(args)
    return overrides[command] ?? workingSnapshotResult(args, root) ?? gitResult("", 99, `unexpected git ${command}`)
  })
}

function context(cwd = "/repo"): ExtensionContext {
  return { cwd } as ExtensionContext
}

async function initializeRepository(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  runRealGit(root, ["init", "--quiet", "--initial-branch=main"])
  runRealGit(root, ["config", "user.email", "tests@example.com"])
  runRealGit(root, ["config", "user.name", "Tests"])
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(root, path), contents)
  }
  runRealGit(root, ["add", "--all"])
  runRealGit(root, ["commit", "--quiet", "-m", "initial"])
}

test("working snapshot distinguishes a missing repository from a clean repository", async () => {
  const missing = createPi(() => gitResult("", 128, "fatal: not a git repository"))
  const missingDocument = await loadWorkingTreeDocument(missing, context("/tmp/project"))
  assert.equal(missingDocument.repositoryState, "missing")
  assert.equal(missingDocument.working.files.length, 0)
  assert.equal(missingDocument.staged.files.length, 0)

  const cleanDocument = await loadWorkingTreeDocument(snapshotPi(), context())
  assert.equal(cleanDocument.repositoryState, "ready")
  assert.equal(cleanDocument.headState, "present")
  assert.equal(cleanDocument.working.files.length, 0)
  assert.equal(cleanDocument.staged.files.length, 0)
})

test("a bare repository is an explicit load failure rather than a missing repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-bare-"))
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--quiet"], { cwd: root, encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)

    await assert.rejects(() => loadWorkingTreeDocument(realGitPi(), context(root)), GitCommandError)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("repository detection rejects unexpected and killed failures", async () => {
  const unexpected = createPi(() => gitResult("", 2, "fatal: permission denied"))
  await assert.rejects(() => loadWorkingTreeDocument(unexpected, context()), GitCommandError)

  const misleadingStdout = createPi(() => gitResult("not a git repository", 2, "fatal: permission denied"))
  await assert.rejects(() => loadWorkingTreeDocument(misleadingStdout, context()), GitCommandError)

  const unexpectedMissingCode = createPi(() => gitResult("", 2, "fatal: not a git repository"))
  await assert.rejects(() => loadWorkingTreeDocument(unexpectedMissingCode, context()), GitCommandError)

  const killed = createPi(() => gitResult("", 0, "", true))
  await assert.rejects(
    () => loadWorkingTreeDocument(killed, context()),
    (error: unknown) => error instanceof GitTimeoutError && error.timeoutMs > 0,
  )
})

test("oversized untracked files remain visible without an unbounded preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-large-"))
  try {
    runRealGit(root, ["init", "--quiet", "--initial-branch=main"])
    await writeFile(join(root, "large.txt"), "x".repeat(MAX_UNTRACKED_FILE_BYTES + 1))

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const file = document.working.files.find((entry) => entry.path === "large.txt")

    assert.equal(file?.untracked, true)
    assert.equal(file?.stageState, "unstaged")
    assert.deepEqual(file?.lines, [])
    assert.equal(document.staged.files.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a real repository with no commits loads through the unborn-HEAD path", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-unborn-"))
  try {
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)
    await writeFile(join(root, "first.txt"), "first line\n")

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))

    assert.equal(document.repositoryState, "ready")
    assert.equal(document.headState, "unborn")
    assert.equal(document.working.files[0]?.path, "first.txt")
    assert.equal(document.working.files[0]?.untracked, true)
    assert.equal(document.staged.files.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an unborn snapshot shows working-tree content newer than the index", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-unborn-mixed-"))
  try {
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" })
    assert.equal(initialized.status, 0, initialized.stderr)
    await writeFile(join(root, "mixed.txt"), "staged content\n")
    const stagedResult = spawnSync("git", ["add", "mixed.txt"], { cwd: root, encoding: "utf8" })
    assert.equal(stagedResult.status, 0, stagedResult.stderr)
    await writeFile(join(root, "mixed.txt"), "working content\n")

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const staged = document.staged.files.find((entry) => entry.path === "mixed.txt")
    const working = document.working.files.find((entry) => entry.path === "mixed.txt")

    assert.equal(document.headState, "unborn")
    assert.equal(staged?.stageState, "mixed")
    assert.equal(working?.stageState, "mixed")
    assert.ok(staged?.lines.some((line) => line === "+staged content"))
    assert.ok(working?.lines.some((line) => line === "+working content"))
    assert.ok(working?.lines.some((line) => line === "-staged content"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("partially staged, staged-only, and unstaged-only files use exact slices", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-exact-"))
  try {
    await initializeRepository(root, {
      "mixed.txt": "base one\nbase two\n",
      "staged-only.txt": "base\n",
      "working-only.txt": "base\n",
    })
    await writeFile(join(root, "mixed.txt"), "staged one\nbase two\n")
    await writeFile(join(root, "staged-only.txt"), "staged only\n")
    runRealGit(root, ["add", "mixed.txt", "staged-only.txt"])
    await writeFile(join(root, "mixed.txt"), "staged one\nworking two\n")
    await writeFile(join(root, "working-only.txt"), "working only\n")

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const stagedMixed = document.staged.files.find((file) => file.path === "mixed.txt")
    const workingMixed = document.working.files.find((file) => file.path === "mixed.txt")

    assert.deepEqual(document.staged.files.map((file) => file.path).sort(), ["mixed.txt", "staged-only.txt"])
    assert.deepEqual(document.working.files.map((file) => file.path).sort(), ["mixed.txt", "working-only.txt"])
    assert.equal(stagedMixed?.stageState, "mixed")
    assert.equal(workingMixed?.stageState, "mixed")
    assert.ok(stagedMixed?.lines.includes("+staged one"))
    assert.ok(!stagedMixed?.lines.includes("+working two"))
    assert.ok(workingMixed?.lines.includes("+working two"))
    assert.ok(!workingMixed?.lines.includes("+staged one"))
    assert.deepEqual(document.staged.stats, { files: 2, additions: 2, deletions: 2 })
    assert.deepEqual(document.working.stats, { files: 2, additions: 2, deletions: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a staged rename and later edit remain one mixed logical file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-rename-"))
  try {
    await initializeRepository(root, { "old-name.txt": "line one\nline two\nline three\n" })
    runRealGit(root, ["mv", "old-name.txt", "new-name.txt"])
    runRealGit(root, ["add", "--all"])
    await writeFile(join(root, "new-name.txt"), "line one\nline two changed\nline three\n")

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const staged = document.staged.files[0]
    const working = document.working.files[0]

    assert.equal(staged?.status, "renamed")
    assert.equal(staged?.oldPath, "old-name.txt")
    assert.equal(staged?.newPath, "new-name.txt")
    assert.equal(staged?.stageState, "mixed")
    assert.equal(working?.path, "new-name.txt")
    assert.equal(working?.stageState, "mixed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("unmerged conflicts are represented and never mistaken for a clean index", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-conflict-"))
  try {
    await initializeRepository(root, { "conflict.txt": "base\n" })
    runRealGit(root, ["switch", "--quiet", "-c", "side"])
    await writeFile(join(root, "conflict.txt"), "side\n")
    runRealGit(root, ["commit", "--quiet", "-am", "side"])
    runRealGit(root, ["switch", "--quiet", "main"])
    await writeFile(join(root, "conflict.txt"), "main\n")
    runRealGit(root, ["commit", "--quiet", "-am", "main"])
    runRealGit(root, ["merge", "--no-edit", "side"], 1)

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const conflict = document.working.files.find((file) => file.path === "conflict.txt")

    assert.equal(conflict?.status, "conflicted")
    assert.equal(conflict?.stageState, "conflicted")
    assert.ok(document.working.stats.files > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("binary files count as files without fabricated line counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-index-binary-"))
  try {
    await initializeRepository(root, { "binary.dat": Uint8Array.from([0, 1, 2, 3]) })
    await writeFile(join(root, "binary.dat"), Uint8Array.from([0, 1, 9, 3]))

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))

    assert.equal(document.working.files[0]?.status, "binary")
    assert.deepEqual(document.working.stats, { files: 1, additions: 0, deletions: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("dirty submodules cannot be staged or discarded from the parent viewer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-submodule-parent-"))
  const child = await mkdtemp(join(tmpdir(), "pi-git-submodule-child-"))
  try {
    await initializeRepository(root, { "root.txt": "root\n" })
    await initializeRepository(child, { "tracked.txt": "nested\n" })
    runRealGit(root, ["-c", "protocol.file.allow=always", "submodule", "add", child, "vendor/module"])
    runRealGit(root, ["commit", "--quiet", "-am", "add submodule"])
    await writeFile(join(root, "vendor/module/tracked.txt"), "dirty nested worktree\n")

    const document = await loadWorkingTreeDocument(realGitPi(), context(root))
    const submodule = document.working.files.find((file) => file.path === "vendor/module")
    assert.ok(submodule)
    assert.equal(submodule.submodule, "S.M.")
    await assert.rejects(
      () => stageRemainingFile(realGitPi(), root, submodule),
      /manage nested changes inside the submodule/u,
    )
    await assert.rejects(
      () => discardFileChanges(realGitPi(), root, submodule),
      /manage nested changes inside the submodule/u,
    )
    await assert.rejects(
      () => stageAllRemaining(realGitPi(), root),
      /Cannot stage all while nested submodule changes are present/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(child, { recursive: true, force: true })
  }
})

test("clean submodule pointer updates can be explicitly staged and unstaged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-submodule-stage-parent-"))
  const child = await mkdtemp(join(tmpdir(), "pi-git-submodule-stage-child-"))
  try {
    await initializeRepository(root, { "root.txt": "root\n" })
    await initializeRepository(child, { "tracked.txt": "nested\n" })
    runRealGit(root, ["-c", "protocol.file.allow=always", "submodule", "add", child, "vendor/module"])
    runRealGit(root, ["commit", "--quiet", "-am", "add submodule"])
    const nested = join(root, "vendor/module")
    runRealGit(nested, ["config", "user.email", "tests@example.com"])
    runRealGit(nested, ["config", "user.name", "Tests"])
    await writeFile(join(nested, "tracked.txt"), "advanced pointer\n")
    runRealGit(nested, ["commit", "--quiet", "-am", "advance submodule"])

    const unstagedDocument = await loadWorkingTreeDocument(realGitPi(), context(root))
    const unstaged = unstagedDocument.working.files.find((file) => file.path === "vendor/module")
    assert.ok(unstaged)
    assert.equal(unstaged.submodule, "SC..")
    await stageRemainingFile(realGitPi(), root, unstaged)

    const stagedDocument = await loadWorkingTreeDocument(realGitPi(), context(root))
    const staged = stagedDocument.staged.files.find((file) => file.path === "vendor/module")
    assert.ok(staged)
    assert.equal(staged.submodule, "S...")
    await unstageFile(realGitPi(), root, staged)
    assert.match(runRealGit(root, ["status", "--short"]), /^ M vendor\/module$/mu)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(child, { recursive: true, force: true })
  }
})

test("bounded historical loading exposes omitted files instead of buffering oversized patches", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-historical-large-"))
  try {
    await initializeRepository(root, { "large.txt": "small\n" })
    await writeFile(join(root, "large.txt"), "x".repeat(10 * 1024 * 1024))
    runRealGit(root, ["commit", "--quiet", "-am", "large historical change"])
    const hash = runRealGit(root, ["rev-parse", "HEAD"]).trim()

    const document = await loadCommitDocument(realGitPi(), {
      cwd: root,
      commit: { hash, message: "large historical change" },
    })

    assert.equal(document.diff.raw, "")
    assert.equal(document.diff.files[0]?.path, "large.txt")
    assert.equal(document.diff.files[0]?.omission?.reason, "file-too-large")
    assert.equal(document.diff.capturedPatchBytes, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("failed historical capture rejects document loading", async () => {
  const pi = snapshotPi({
    "rev-parse --verify abc123^{commit}": gitResult("", 128, "fatal: bad object abc123"),
  })

  await assert.rejects(
    () => loadCommitDocument(pi, { cwd: "/repo", commit: { hash: "abc123", message: "missing" } }),
    /bad object abc123/u,
  )
})
