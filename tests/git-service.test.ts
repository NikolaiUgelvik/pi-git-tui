import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createAndSwitchBranch, getBranches, getBranchName, switchBranch } from "../src/git-branch-service.js"
import { runGitCommand } from "../src/git-command-service.js"
import { getCommitRangeDiff, getStagedDiff } from "../src/git-diff-service.js"
import { getCommitCount, getCommitMessage, getCommits } from "../src/git-history-service.js"
import {
  getStagedPaths,
  stagedDiffForCommitMessage,
  stageOrUnstageFile,
  toggleAllChangesStaged,
} from "../src/git-index-service.js"
import {
  assertGitSuccess,
  compactGitOutput,
  ensureGitRepository,
  git,
  requireGitRepository,
} from "../src/git-service.js"
import { applyStash, dropStash, getStashes, popStash, stashCurrentChanges } from "../src/git-stash-service.js"
import { getWorktrees, switchWorktree } from "../src/git-worktree-service.js"
import { GIT_TIMEOUT_MS, type GitExecResult, MAX_COMMIT_MESSAGE_DIFF_CHARS } from "../src/types.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }
type ExecCall = { cmd: string; args: string[]; options?: ExecOptions }

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourceDir = __dirname.includes(".tmp-tests") ? __dirname.replace(".tmp-tests/", "") : __dirname
const fixturesDir = join(sourceDir, "fixtures")

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8")
}

function gitResult(stdout = "", code = 0, stderr = ""): GitExecResult {
  return { stdout, stderr, code, killed: false }
}

function createPi(handler: (args: string[], options?: ExecOptions) => GitExecResult): {
  pi: ExtensionAPI
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  const pi = {
    exec: (cmd: string, args: string[], options?: ExecOptions) => {
      calls.push({ cmd, args, options })
      assert.equal(cmd, "git")
      return handler(args, options)
    },
  } as unknown as ExtensionAPI
  return { pi, calls }
}

function createRepoPi(handler: (args: string[], options?: ExecOptions) => GitExecResult): {
  pi: ExtensionAPI
  calls: ExecCall[]
} {
  return createPi((args, options) => {
    if (args.join(" ") === "rev-parse --show-toplevel") {
      return gitResult("/repo\n")
    }
    assert.equal(options?.cwd, "/repo")
    return handler(args, options)
  })
}

test("git passes git arguments, cwd, signal, and timeout to pi.exec", async () => {
  const signal = new AbortController().signal
  const { pi, calls } = createPi(() => gitResult("main\n"))

  const result = await git(pi, "/repo", ["branch", "--show-current"], signal)

  assert.equal(result.stdout, "main\n")
  assert.deepEqual(calls, [
    { cmd: "git", args: ["branch", "--show-current"], options: { cwd: "/repo", signal, timeout: GIT_TIMEOUT_MS } },
  ])
})

test("repository helpers parse root and enforce repository presence", async () => {
  const { pi } = createPi((args) => {
    assert.deepEqual(args, ["rev-parse", "--show-toplevel"])
    return gitResult("/repo\n")
  })

  assert.equal(await ensureGitRepository(pi, "/repo/src"), "/repo")
  assert.equal(await requireGitRepository(pi, "/repo/src"), "/repo")
})

test("repository helpers handle non-repositories", async () => {
  const { pi } = createPi(() => gitResult("", 128, "fatal: not a git repository"))

  assert.equal(await ensureGitRepository(pi, "/tmp"), undefined)
  await assert.rejects(() => requireGitRepository(pi, "/tmp"), /Not a git repository/u)
})

test("compactGitOutput and assertGitSuccess format git failures", () => {
  assert.equal(compactGitOutput(gitResult(" hello\n\nworld ", 0, " warning ")), "hello world warning")
  assert.doesNotThrow(() => assertGitSuccess(gitResult("ok"), ["status"]))
  assert.throws(() => assertGitSuccess(gitResult("", 1, "fatal error"), ["status"]), /fatal error/u)
  assert.throws(() => assertGitSuccess(gitResult("", 1, ""), ["status"]), /git status failed/u)
})

test("branch service parses branch list and runs branch commands", async () => {
  const { pi, calls } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command.startsWith("branch --format")) return gitResult(readFixture("branch-list.txt"))
    if (command === "switch feature-abc") return gitResult("")
    if (command === "switch -c new-branch") return gitResult("")
    return gitResult("", 1, `unexpected ${command}`)
  })

  assert.deepEqual(await getBranches(pi, "/repo/src"), [
    { name: "main", current: true, upstream: "origin/main", track: "ahead 1" },
    { name: "feature-abc", current: false, upstream: "origin/feature-abc", track: undefined },
    { name: "develop", current: false, upstream: "origin/develop", track: "behind 2" },
    { name: "hotfix/urgent", current: false, upstream: "origin/hotfix/urgent", track: undefined },
  ])
  assert.equal(await switchBranch(pi, "/repo", "feature-abc"), "Switched to feature-abc")
  assert.equal(await createAndSwitchBranch(pi, "/repo", "new-branch"), "Created and switched to new-branch")
  assert.ok(calls.some((call) => call.args.join(" ") === "switch feature-abc"))
})

test("getBranchName returns current branch or detached HEAD label", async () => {
  const current = createRepoPi((args) =>
    args.join(" ") === "branch --show-current" ? gitResult("main\n") : gitResult(""),
  )
  assert.equal(await getBranchName(current.pi, "/repo"), "main")

  const detached = createRepoPi((args) => {
    if (args.join(" ") === "branch --show-current") return gitResult("\n")
    if (args.join(" ") === "rev-parse --short HEAD") return gitResult("abc1234\n")
    return gitResult("", 1)
  })
  assert.equal(await getBranchName(detached.pi, "/repo"), "detached abc1234")
})

test("history service parses commits and reads commit details", async () => {
  const { pi } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command.startsWith("log --max-count=")) return gitResult(readFixture("commit-list.txt"))
    if (command === "log -1 --format=%s abcdef0") return gitResult("Initial commit\n")
    if (command === "rev-list --count HEAD") return gitResult("42\n")
    return gitResult("", 1, `unexpected ${command}`)
  })

  const commits = await getCommits(pi, "/repo")
  assert.equal(commits[0]?.hash, "abcdef0")
  assert.equal(commits[0]?.message, "Initial commit")
  assert.equal(await getCommitMessage(pi, "/repo", "abcdef0"), "Initial commit")
  assert.equal(await getCommitCount(pi, "/repo"), 42)
})

test("diff service returns staged and commit range diffs", async () => {
  const { pi } = createRepoPi((args) => {
    if (args.includes("--cached")) return gitResult("cached diff")
    if (args.includes("main...feature")) return gitResult("range diff")
    return gitResult("", 1)
  })

  assert.equal(await getStagedDiff(pi, "/repo"), "cached diff")
  assert.equal(await getCommitRangeDiff(pi, "/repo", "main", "feature"), "range diff")
})

test("index service stages, unstages, toggles all changes, and lists staged paths", async () => {
  const { pi } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command === "diff --cached --quiet -- src/file.ts") return gitResult("", 0)
    if (command === "add -- src/file.ts") return gitResult("")
    if (command === "diff --cached --name-only -z") return gitResult("src/file.ts\0")
    if (command === "diff --quiet --") return gitResult("", 1)
    if (command === "add --all") return gitResult("")
    return gitResult("", 1, `unexpected ${command}`)
  })

  assert.equal(await stageOrUnstageFile(pi, "/repo", "src/file.ts"), "Staged src/file.ts")
  assert.equal(await toggleAllChangesStaged(pi, "/repo"), "Staged all changes")
  assert.deepEqual(await getStagedPaths(pi, "/repo"), new Set(["src/file.ts"]))
})

test("stagedDiffForCommitMessage combines stat and diff and truncates long output", async () => {
  const longDiff = "x".repeat(MAX_COMMIT_MESSAGE_DIFF_CHARS + 5)
  const { pi } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command === "diff --cached --stat --color=never") return gitResult("stat")
    if (args.includes("--cached")) return gitResult(longDiff)
    return gitResult("", 1)
  })

  const result = await stagedDiffForCommitMessage(pi, "/repo")

  assert.ok(result.startsWith("stat\n\n"))
  assert.ok(result.endsWith("\n\n[diff truncated]"))
  assert.equal(result.includes(longDiff), false)
})

test("stash service parses list and runs stash commands", async () => {
  const { pi } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command === "stash list --format=%gd%x00%s") return gitResult(readFixture("stash-list.txt"))
    if (command === "stash push -u -m WIP from pi-git") return gitResult("Saved working directory")
    if (command === "stash apply stash@{0}") return gitResult("")
    if (command === "stash pop stash@{0}") return gitResult("")
    if (command === "stash drop stash@{0}") return gitResult("")
    return gitResult("", 1, `unexpected ${command}`)
  })

  assert.deepEqual(await getStashes(pi, "/repo"), [
    { ref: "stash@{0}", message: "WIP on main: abcdef0 Initial commit" },
    { ref: "stash@{1}", message: "On main: WIP from pi-git" },
    { ref: "stash@{2}", message: "WIP on feature-abc: 1234567 Add new feature" },
  ])
  assert.equal(await stashCurrentChanges(pi, "/repo"), "Saved working directory")
  assert.equal(await applyStash(pi, "/repo", "stash@{0}"), "Applied stash@{0}")
  assert.equal(await popStash(pi, "/repo", "stash@{0}"), "Popped stash@{0}")
  assert.equal(await dropStash(pi, "/repo", "stash@{0}"), "Dropped stash@{0}")
})

test("worktree service parses porcelain output and reports switch result", async () => {
  const { pi } = createRepoPi((args) => {
    const command = args.join(" ")
    if (command === "worktree list --porcelain") return gitResult(readFixture("worktree-list.txt"))
    if (command === "worktree add -f /repo-new --detach") return gitResult("", 1, "exists")
    return gitResult("", 1, `unexpected ${command}`)
  })

  assert.deepEqual(await getWorktrees(pi, "/repo"), [
    { path: "/repo-main", head: "abcdef0", branch: "main" },
    { path: "/repo-feature", head: "1234567", branch: "feature-abc" },
    { path: "/repo-detached", head: "9876543", detached: true },
  ])
  assert.equal(await switchWorktree(pi, "/repo", "/repo-new"), "Switched to worktree at /repo-new")
})

test("command service runs configured git command", async () => {
  const { pi } = createRepoPi((args) => {
    assert.deepEqual(args, ["fetch"])
    return gitResult("updated")
  })

  assert.equal(
    await runGitCommand(pi, "/repo", {
      label: "Fetch",
      description: "Fetch updates",
      args: ["fetch"],
      refreshDiff: true,
    }),
    "Fetch complete: updated",
  )
})
