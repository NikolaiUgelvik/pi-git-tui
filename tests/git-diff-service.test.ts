import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadCommitDocument, loadWorkingTreeDocument } from "../src/git-diff-service.js"
import { GitCommandError } from "../src/git-service.js"
import { type GitExecResult, MAX_UNTRACKED_FILE_BYTES } from "../src/types.js"
import { realGitPi, runGit } from "./helpers/real-git.js"
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
  runGit(root, ["init", "--quiet", "--initial-branch=main"])
  runGit(root, ["config", "user.email", "tests@example.com"])
  runGit(root, ["config", "user.name", "Tests"])
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(root, path), contents)
  }
  runGit(root, ["add", "--all"])
  runGit(root, ["commit", "--quiet", "-m", "initial"])
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
    (error: unknown) =>
      error instanceof GitCommandError && error.reason === "killed" && /killed or timed out/u.test(error.details),
  )
})

test("unborn HEAD detection requires the expected Git diagnostic on stderr", async () => {
  const pi = snapshotPi({
    "rev-parse --verify HEAD": gitResult("fatal: Needed a single revision", 128, "fatal: permission denied"),
  })

  await assert.rejects(() => loadWorkingTreeDocument(pi, context()), GitCommandError)
})

test("an unborn HEAD follows an explicit successful snapshot path", async () => {
  const pi = snapshotPi({
    "rev-parse --verify HEAD": gitResult("", 128, "fatal: Needed a single revision"),
    "branch --show-current": gitResult("main\n"),
    "-c core.quotepath=false diff --no-ext-diff --find-renames --find-copies --color=never 4b825dc642cb6eb9a060e54bf8d69288fbee4904 --":
      gitResult(),
  })

  const document = await loadWorkingTreeDocument(pi, context())

  assert.equal(document.headState, "unborn")
  assert.equal(document.title, "Working tree and index (no commits yet)")
  assert.equal(document.repositoryState, "ready")
})

test("failure of every required working snapshot query rejects the snapshot", async (t) => {
  const failures: Array<[string, string]> = [
    ["head", "rev-parse --verify HEAD"],
    ["branch identity", "branch --show-current"],
    [
      "staged diff",
      "-c core.quotepath=false diff --no-ext-diff --find-renames --find-copies --color=never --cached --",
    ],
    ["working diff", "-c core.quotepath=false diff --no-ext-diff --find-renames --find-copies --color=never --"],
    ["untracked paths", "ls-files --others --exclude-standard -z"],
    ["conflicts", "diff --name-only --diff-filter=U -z"],
    ["upstream identity", "rev-list --left-right --count @{upstream}...HEAD"],
  ]

  for (const [label, command] of failures) {
    await t.test(label, async () => {
      const pi = snapshotPi({ [command]: gitResult("", 17, `fatal: ${label} failed`) })
      await assert.rejects(() => loadWorkingTreeDocument(pi, context()), new RegExp(`${label} failed`, "u"))
    })
  }
})

test("missing-upstream text is expected only with Git's exit 128", async () => {
  const pi = snapshotPi({
    "rev-list --left-right --count @{upstream}...HEAD": gitResult(
      "",
      17,
      "fatal: no upstream configured for branch 'main'",
    ),
  })

  await assert.rejects(() => loadWorkingTreeDocument(pi, context()), GitCommandError)
})

test("untracked no-index exit one is expected and its patch is included", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-snapshot-"))
  try {
    await writeFile(join(root, "new.txt"), "hello\n")
    const patch = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n")
    const pi = snapshotPi(
      {
        "ls-files --others --exclude-standard -z": gitResult("new.txt\0"),
        "-c core.quotepath=false ls-files --stage -z -- new.txt": gitResult(),
        "-c core.quotepath=false ls-tree -r --name-only -z HEAD -- new.txt": gitResult(),
        "-c core.quotepath=false diff --no-index -- /dev/null new.txt": gitResult(patch, 1),
      },
      root,
    )

    const document = await loadWorkingTreeDocument(pi, context(root))

    assert.equal(document.working.files[0]?.path, "new.txt")
    assert.equal(document.working.files[0]?.untracked, true)
    assert.equal(document.staged.files.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("oversized untracked files remain visible without an unbounded preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-large-"))
  try {
    runGit(root, ["init", "--quiet", "--initial-branch=main"])
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

test("a path staged after untracked discovery is not reintroduced as a stale placeholder", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-race-"))
  try {
    await writeFile(join(root, "raced.txt"), "content\n")
    const pi = snapshotPi(
      {
        "ls-files --others --exclude-standard -z": gitResult("raced.txt\0"),
        "-c core.quotepath=false ls-files --stage -z -- raced.txt": gitResult("100644 abc 0\traced.txt\0"),
        "-c core.quotepath=false ls-tree -r --name-only -z HEAD -- raced.txt": gitResult(),
      },
      root,
    )

    const document = await loadWorkingTreeDocument(pi, context(root))

    assert.equal(document.working.files.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("unexpected untracked preview query failures reject the complete snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-errors-"))
  try {
    await writeFile(join(root, "new.txt"), "hello\n")
    const trackedCommand = "-c core.quotepath=false ls-files --stage -z -- new.txt"
    const headCommand = "-c core.quotepath=false ls-tree -r --name-only -z HEAD -- new.txt"
    const diffCommand = "-c core.quotepath=false diff --no-index -- /dev/null new.txt"
    const base = {
      "ls-files --others --exclude-standard -z": gitResult("new.txt\0"),
      [trackedCommand]: gitResult(),
      [headCommand]: gitResult(),
      [diffCommand]: gitResult("patch", 1),
    }
    const failures: Array<[string, Record<string, GitExecResult>]> = [
      ["tracked race check", { ...base, [trackedCommand]: gitResult("", 3, "fatal: index unreadable") }],
      ["HEAD race check", { ...base, [headCommand]: gitResult("", 3, "fatal: object database unreadable") }],
      ["no-index exit", { ...base, [diffCommand]: gitResult("partial", 2, "fatal: diff failed") }],
      ["no-index killed", { ...base, [diffCommand]: gitResult("", 1, "timed out", true) }],
    ]

    for (const [label, overrides] of failures) {
      await t.test(label, async () => {
        await assert.rejects(() => loadWorkingTreeDocument(snapshotPi(overrides, root), context(root)), GitCommandError)
      })
    }
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
    runGit(root, ["add", "mixed.txt", "staged-only.txt"])
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
    runGit(root, ["mv", "old-name.txt", "new-name.txt"])
    runGit(root, ["add", "--all"])
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
    runGit(root, ["switch", "--quiet", "-c", "side"])
    await writeFile(join(root, "conflict.txt"), "side\n")
    runGit(root, ["commit", "--quiet", "-am", "side"])
    runGit(root, ["switch", "--quiet", "main"])
    await writeFile(join(root, "conflict.txt"), "main\n")
    runGit(root, ["commit", "--quiet", "-am", "main"])
    runGit(root, ["merge", "--no-edit", "side"], 1)

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

test("failed git show rejects historical document loading", async () => {
  const pi = snapshotPi({
    "-c core.quotepath=false show --format= --no-ext-diff --find-renames --find-copies --color=never abc123 --":
      gitResult("partial output", 128, "fatal: bad object abc123"),
  })

  await assert.rejects(
    () => loadCommitDocument(pi, { cwd: "/repo", commit: { hash: "abc123", message: "missing" } }),
    /bad object abc123/u,
  )
})
