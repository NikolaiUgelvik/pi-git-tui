import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { listWorktrees, parseWorktreeList } from "../src/git-extras.js"
import type { GitExecResult } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { HELP_ACTIONS } from "../src/viewer-help.js"
import { workingDocument } from "./helpers/viewer.js"

type ExecCall = { cmd: string; args: string[]; cwd: string | undefined }

function gitResult(stdout = "", code = 0, stderr = ""): GitExecResult {
  return { stdout, stderr, code, killed: false }
}

function createPi(handler: (args: string[], cwd: string | undefined) => GitExecResult): ExtensionAPI {
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

const initialDocument = workingDocument("/repo-main")

async function flushAsyncViewerWork(): Promise<void> {
  await tick()
  await tick()
}

function createWorktreeSwitchPi(calls: ExecCall[]): ExtensionAPI {
  const responses = new Map<string, (cwd: string | undefined) => GitExecResult>([
    ["rev-parse --show-toplevel", (cwd) => gitResult(`${cwd ?? "/repo-main"}\n`)],
    ["worktree list --porcelain", () => gitResult(worktreePorcelain)],
    ["rev-parse --verify HEAD", () => gitResult("1234567\n")],
    ["branch --show-current", () => gitResult("feature-abc\n")],
    ["ls-files --others --exclude-standard -z", () => gitResult("")],
    ["diff --name-only --diff-filter=U -z", () => gitResult("")],
    [
      "rev-list --left-right --count @{upstream}...HEAD",
      () => gitResult("", 128, "fatal: no upstream configured for branch 'feature-abc'"),
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

test("listWorktrees runs from repository root and parses porcelain output", async () => {
  const calls: ExecCall[] = []
  const pi = createPi((args, cwd) => {
    calls.push({ cmd: "git", args, cwd })
    if (args.join(" ") === "rev-parse --show-toplevel") {
      return gitResult("/repo-main\n")
    }
    if (args.join(" ") === "worktree list --porcelain") {
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
    ["rev-parse --show-toplevel", "worktree list --porcelain"],
  )
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
