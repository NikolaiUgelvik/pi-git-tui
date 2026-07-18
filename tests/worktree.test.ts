import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { listWorktrees, parseWorktreeList } from "../src/git-extras.js"
import type { DiffDocument } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { HELP_ACTIONS } from "../src/viewer-help.js"
import { createTempGitRepository, createTrackingGitPi, runFixtureGit } from "./helpers/temp-git-repository.js"

type ExecCall = { cmd: string; args: string[]; cwd: string | undefined }

type RawGitResult = { stdout: string; stderr: string; code: number; killed: boolean }

function gitResult(stdout = "", code = 0, stderr = ""): RawGitResult {
  return { stdout, stderr, code, killed: false }
}

function createPi(handler: (args: string[], cwd: string | undefined) => RawGitResult): ExtensionAPI {
  const pi = {
    exec: async (cmd: string, args: string[], options?: { cwd?: string }) => {
      assert.equal(cmd, "git")
      return handler(args, options?.cwd)
    },
  }
  return pi as unknown as ExtensionAPI
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourceDir = __dirname.includes(".tmp-tests") ? __dirname.replace(".tmp-tests/", "") : __dirname
const fixturesDir = join(sourceDir, "fixtures")

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8")
}

const worktreePorcelain = readFixture("worktree-list.txt")

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

const initialDocument: DiffDocument = {
  mode: "working",
  title: "Working tree vs HEAD",
  subtitle: "/repo-main (main)",
  raw: "",
  files: [],
  omittedFileCount: 0,
  capturedPatchBytes: 0,
  capturedPatchLines: 0,
  repositoryState: "ready",
}

async function flushAsyncViewerWork(): Promise<void> {
  await tick()
  await tick()
}

function createWorktreeSwitchPi(calls: ExecCall[]): ExtensionAPI {
  const responses = new Map<string, (cwd: string | undefined) => RawGitResult>([
    ["rev-parse --show-toplevel", (cwd) => gitResult(`${cwd ?? "/repo-main"}\n`)],
    ["worktree list --porcelain -z", () => gitResult(worktreePorcelain)],
    [
      "status --porcelain=v2 --branch -z --untracked-files=all --ignore-submodules=none --find-renames",
      () => gitResult("# branch.oid 1234567890123456789012345678901234567890\0# branch.head feature-abc\0"),
    ],
  ])
  return createPi((args, cwd) => {
    calls.push({ cmd: "git", args, cwd })
    const command = args.join(" ")
    const response = responses.get(command) ?? (args.includes("diff") ? () => gitResult("") : undefined)
    return response?.(cwd) ?? gitResult("", 1, `unexpected git ${command}`)
  })
}

test("parseWorktreeList parses porcelain worktree entries", () => {
  assert.deepEqual(parseWorktreeList(worktreePorcelain), [
    { path: "/repo-main", head: "abcdef0", branch: "main" },
    { path: "/repo-feature", head: "1234567", branch: "feature-abc" },
    { path: "/repo-detached", head: "9876543", detached: true },
  ])
})

test("parseWorktreeList preserves NUL-delimited whitespace and Unicode paths", () => {
  const path = "/tmp/linked space\tline\nλ"
  const output = [`worktree ${path}`, "HEAD abcdef0", "branch refs/heads/feature", "", ""].join("\0")

  assert.deepEqual(parseWorktreeList(output), [{ path, head: "abcdef0", branch: "feature" }])
})

test("listWorktrees runs from repository root and parses porcelain output", async () => {
  const calls: ExecCall[] = []
  const pi = createPi((args, cwd) => {
    calls.push({ cmd: "git", args, cwd })
    if (args.join(" ") === "rev-parse --show-toplevel") {
      return gitResult("/repo-main\n")
    }
    if (args.join(" ") === "worktree list --porcelain -z") {
      assert.equal(cwd, "/repo-main")
      return gitResult(worktreePorcelain)
    }
    return gitResult("", 1, `unexpected git ${args.join(" ")}`)
  })
  assert.deepEqual(await listWorktrees(pi, "/repo-main"), [
    { path: "/repo-main", head: "abcdef0", branch: "main" },
    { path: "/repo-feature", head: "1234567", branch: "feature-abc" },
    { path: "/repo-detached", head: "9876543", detached: true },
  ])
  assert.deepEqual(
    calls.map((call) => call.args.join(" ")),
    ["rev-parse --show-toplevel", "worktree list --porcelain -z"],
  )
})

test("listWorktrees preserves a real linked path containing whitespace and Unicode", async () => {
  const repo = await createTempGitRepository()
  const linkedPath = `${repo.path}-linked space\tline\nλ`
  try {
    await runFixtureGit(repo.path, ["branch", "feature"])
    await runFixtureGit(repo.path, ["worktree", "add", linkedPath, "feature"])

    const worktrees = await listWorktrees(createTrackingGitPi().pi, repo.path)

    assert.equal(
      worktrees.some((worktree) => worktree.path === linkedPath && worktree.branch === "feature"),
      true,
    )
  } finally {
    await runFixtureGit(repo.path, ["worktree", "remove", "--force", linkedPath]).catch(() => undefined)
    await rm(linkedPath, { recursive: true, force: true })
    await repo.cleanup()
  }
})

test("viewer help advertises worktree picker controls", () => {
  const actions = HELP_ACTIONS as Record<string, Array<{ keys?: string; action: string }> | undefined>

  assert.ok(actions.viewer?.some((action) => action.keys === "w" && /worktree/i.test(action.action)))
  assert.ok(actions.worktreePicker?.some((action) => action.keys === "Enter" && /select/i.test(action.action)))
})

test("worktree picker switches only the viewer active path", async () => {
  const calls: ExecCall[] = []
  const pi = createWorktreeSwitchPi(calls)
  const ctx = Object.freeze({ cwd: "/repo-main" }) as ExtensionContext
  const viewer = new DiffViewer(
    pi,
    ctx,
    theme,
    initialDocument,
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("w")
  await flushAsyncViewerWork()
  viewer.handleInput("feature")
  viewer.handleInput("\n")
  await flushAsyncViewerWork()

  assert.equal(ctx.cwd, "/repo-main")
  assert.ok(calls.some((call) => call.cwd === "/repo-feature" && call.args.join(" ") === "rev-parse --show-toplevel"))
  assert.match(viewer.render(120).join("\n"), /\/repo-feature \(feature-abc\)/)
})
