import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument } from "../src/diff-document.js"
import { loadWorkingTreeDocument } from "../src/git-diff-service.js"
import type { DiffFile, GitCommand, GitExecResult } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import { realGitPi, runRealGit } from "./helpers/real-git.js"
import { flushViewerWork, gitResult, testTheme, workingDocument, workingSnapshotResult } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

const changedFile: DiffFile = {
  path: "src/file.ts",
  status: "modified",
  stageState: "unstaged",
  lines: ["diff --git a/src/file.ts b/src/file.ts"],
}

const stagedFile: DiffFile = { ...changedFile, stageState: "staged" }

class MutationViewer extends DiffViewer {
  async stageFile(): Promise<void> {
    this.documentState.setWorkingTreeView("working")
    await this.updateSelectedFileStage(changedFile)
  }

  async unstageFile(): Promise<void> {
    this.documentState.setWorkingTreeView("staged")
    await this.updateSelectedFileStage(stagedFile)
  }

  async stageAll(): Promise<void> {
    this.documentState.setWorkingTreeView("working")
    await this.stageAllVisibleChanges()
  }

  async unstageAll(): Promise<void> {
    this.documentState.setWorkingTreeView("staged")
    await this.stageAllVisibleChanges()
  }

  async switchBranch(): Promise<void> {
    await this.runBranchSwitch("feature")
  }

  async createBranch(): Promise<void> {
    await this.runBranchCreate("feature")
  }

  async commit(amend = false): Promise<void> {
    this.commitAmend = amend
    await this.commitStagedChanges("fix")
  }

  async runCommand(command: GitCommand): Promise<void> {
    await this.runSelectedCommand(command)
  }

  async discard(): Promise<void> {
    this.confirmAction = "discard"
    this.confirmFile = changedFile
    this.confirmState = "open"
    await this.runConfirmedAction()
  }

  async initialize(): Promise<void> {
    this.confirmAction = "init"
    this.confirmFile = undefined
    this.confirmState = "open"
    await this.runConfirmedAction()
  }

  async stashCurrent(): Promise<void> {
    await this.runStashCurrent()
  }

  async stashApply(): Promise<void> {
    await this.runStashApply("stash@{0}")
  }

  async stashPop(): Promise<void> {
    await this.runStashPop("stash@{0}")
  }

  async stashDrop(): Promise<void> {
    await this.runStashDrop("stash@{0}")
  }

  async retry(): Promise<void> {
    await this.retryRefreshOnly()
  }

  cancel(): boolean {
    return this.cancelActiveOperation()
  }

  operationState(): string {
    return this.operationSnapshot().state
  }

  stagedPaths(): string[] {
    return this.document.mode === "working" ? this.document.staged.files.map((file) => file.path) : []
  }

  overlayStates(): string[] {
    return [this.branchState, this.commandMenuState, this.confirmState, this.stashState, this.commitDialogState]
  }
}

function viewer(pi: ExtensionAPI, missing = false): MutationViewer {
  return new MutationViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    missing
      ? workingDocument("/repo", { title: "Not a git repository", repositoryState: "missing" })
      : workingDocument("/repo", { workingFiles: [changedFile], stagedFiles: [stagedFile] }),
    () => {},
    () => {},
    () => 40,
  )
}

function commitPi(runCommit: (signal?: AbortSignal) => GitExecResult | Promise<GitExecResult>) {
  const state: { commitCalls: number; commitSignal?: AbortSignal; rootCalls: number } = {
    commitCalls: 0,
    rootCalls: 0,
  }
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        state.rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "diff --cached --quiet --") return gitResult("", 1)
      if (command === "commit -m fix") {
        state.commitCalls += 1
        state.commitSignal = options?.signal
        return runCommit(options?.signal)
      }
      return workingSnapshotResult(args) ?? gitResult("", 96, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  return { pi, state }
}

function refreshFailingPi(
  mutation: (args: string[]) => boolean,
  extra?: (args: string[]) => GitExecResult | undefined,
) {
  let rootCalls = 0
  let mutationCalls = 0
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 2) return gitResult("", 2, "fatal: refresh failed")
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (mutation(args)) {
        mutationCalls += 1
        return gitResult("mutation complete")
      }
      const custom = extra?.(args)
      if (custom) return custom
      if (args[0] === "--literal-pathspecs" && args.includes("ls-files") && args.includes("--stage")) {
        return gitResult()
      }
      if (command === "diff --cached --quiet --") return gitResult("", 1)
      return workingSnapshotResult(args) ?? gitResult("", 97, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  return { pi, mutationCalls: () => mutationCalls }
}

test("staging adapter preserves success and stores refresh-only recovery", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "--literal-pathspecs add --all -- src/file.ts")
  const diffViewer = viewer(fake.pi)

  await diffViewer.stageFile()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
})

test("unstaging adapter preserves success and stores refresh-only recovery", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "--literal-pathspecs restore --staged -- src/file.ts")
  const diffViewer = viewer(fake.pi)

  await diffViewer.unstageFile()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
})

test("stage-all adapter preserves success and stores refresh-only recovery", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "add --all")
  const diffViewer = viewer(fake.pi)

  await diffViewer.stageAll()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
})

test("unstage-all adapter preserves success and stores refresh-only recovery", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "restore --staged -- .")
  const diffViewer = viewer(fake.pi)

  await diffViewer.unstageAll()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
})

test("branch adapter closes after mutation success when refresh fails", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "switch feature")
  const diffViewer = viewer(fake.pi)

  await diffViewer.switchBranch()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[0], "closed")
})

test("branch creation closes after mutation success when refresh fails", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "switch -c feature")
  const diffViewer = viewer(fake.pi)

  await diffViewer.createBranch()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[0], "closed")
})

test("commit and amend close after mutation success when refresh fails", async (t) => {
  for (const [label, amend, command] of [
    ["commit", false, "commit -m fix"],
    ["amend", true, "commit --amend -m fix"],
  ] as const) {
    await t.test(label, async () => {
      const fake = refreshFailingPi((args) => args.join(" ") === command)
      const diffViewer = viewer(fake.pi)

      await diffViewer.commit(amend)

      assert.equal(fake.mutationCalls(), 1)
      assert.equal(diffViewer.operationState(), "refreshFailed")
      assert.equal(diffViewer.overlayStates()[4], "closed")
    })
  }
})

test("historical documents reject command callbacks before any mutation starts", async () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("unexpected")
    },
  } as unknown as ExtensionAPI
  const commit = { hash: "abc123", message: "historical" }
  const diffViewer = new MutationViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    buildCommitDocument({
      title: "Commit abc123",
      subtitle: "/repo • historical",
      raw: "diff --git a/src/file.ts b/src/file.ts",
      commit,
    }),
    () => {},
    () => {},
    () => 40,
  )

  await diffViewer.runCommand({
    label: "Pull",
    description: "Pull",
    args: ["pull"],
    refreshDiff: true,
    risk: { kind: "normal" },
  })

  assert.equal(execCalls, 0)
  assert.equal(diffViewer.operationState(), "idle")
  assert.equal(diffViewer.overlayStates()[1], "closed")
  assert.match(diffViewer.render(140).join("\n"), /Return to the working tree with W/u)
})

test("command adapter closes after mutation success when refresh fails", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "fetch")
  const diffViewer = viewer(fake.pi)

  await diffViewer.runCommand({
    label: "Fetch",
    description: "Fetch",
    args: ["fetch"],
    refreshDiff: true,
    risk: { kind: "normal" },
  })

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[1], "closed")
})

test("commit hook failure reconciles the reviewed index before reopening", async () => {
  const fake = commitPi(() => gitResult("", 1, "fatal: commit hook changed the index, then failed"))
  const diffViewer = viewer(fake.pi)

  await diffViewer.commit()

  assert.equal(fake.state.commitCalls, 1)
  assert.equal(fake.state.rootCalls, 2)
  assert.equal(diffViewer.operationState(), "failed")
  assert.equal(diffViewer.overlayStates()[4], "open")
})

test("a failing pre-commit hook that stages a file refreshes the reviewed index", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-commit-hook-"))
  try {
    runRealGit(root, ["init", "--quiet", "--initial-branch=main"])
    runRealGit(root, ["config", "user.email", "tests@example.com"])
    runRealGit(root, ["config", "user.name", "Tests"])
    await writeFile(join(root, "reviewed.txt"), "base\n")
    runRealGit(root, ["add", "--all"])
    runRealGit(root, ["commit", "--quiet", "-m", "initial"])
    await writeFile(join(root, "reviewed.txt"), "reviewed change\n")
    runRealGit(root, ["add", "reviewed.txt"])
    const hook = join(root, ".git", "hooks", "pre-commit")
    await writeFile(
      hook,
      "#!/bin/sh\nprintf 'hook staged\\n' > hook-added.txt\ngit add hook-added.txt\necho 'hook rejected after changing index' >&2\nexit 1\n",
    )
    await chmod(hook, 0o755)
    const initial = await loadWorkingTreeDocument(realGitPi(), { cwd: root } as ExtensionContext)
    const diffViewer = new MutationViewer(
      realGitPi(),
      { cwd: root } as ExtensionContext,
      testTheme,
      initial,
      () => {},
      () => {},
      () => 40,
    )

    await diffViewer.commit()

    assert.equal(runRealGit(root, ["rev-list", "--count", "HEAD"]).trim(), "1")
    assert.deepEqual(diffViewer.stagedPaths().sort(), ["hook-added.txt", "reviewed.txt"])
    assert.equal(diffViewer.operationState(), "failed")
    assert.equal(diffViewer.overlayStates()[4], "open")
    assert.match(diffViewer.render(180).join("\n"), /hook rejected after changing index/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("pull failure reconciles once and keeps the command menu open", async () => {
  let pullCalls = 0
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "pull") {
        pullCalls += 1
        return gitResult("", 1, "fatal: pull stopped after updating files")
      }
      return workingSnapshotResult(args) ?? gitResult("", 95, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  await diffViewer.runCommand({
    label: "Pull",
    description: "Pull",
    args: ["pull"],
    refreshDiff: true,
    risk: { kind: "normal" },
  })

  assert.equal(pullCalls, 1)
  assert.equal(rootCalls, 2)
  assert.equal(diffViewer.operationState(), "failed")
  assert.equal(diffViewer.overlayStates()[1], "open")
})

test("fetch failure reconciles partial ref updates before returning to the menu", async () => {
  let fetchCalls = 0
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "fetch") {
        fetchCalls += 1
        return gitResult("", 1, "fatal: fetch stopped after updating origin/main")
      }
      return workingSnapshotResult(args) ?? gitResult("", 95, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  await diffViewer.runCommand({
    label: "Fetch",
    description: "Fetch",
    args: ["fetch"],
    refreshDiff: true,
    risk: { kind: "normal" },
  })

  assert.equal(fetchCalls, 1)
  assert.equal(rootCalls, 2)
  assert.equal(diffViewer.operationState(), "failed")
  assert.equal(diffViewer.overlayStates()[1], "open")
})

test("failed pull reconciliation blocks mutation retry and r retries only the snapshot", async () => {
  let pullCalls = 0
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 2) return gitResult("", 2, "fatal: reconciliation snapshot unavailable")
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "pull") {
        pullCalls += 1
        return gitResult("", 1, "fatal: pull stopped after updating files")
      }
      return workingSnapshotResult(args) ?? gitResult("", 94, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  await diffViewer.runCommand({
    label: "Pull",
    description: "Pull",
    args: ["pull"],
    refreshDiff: true,
    risk: { kind: "normal" },
  })

  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[1], "closed")
  await diffViewer.retry()

  assert.equal(pullCalls, 1)
  assert.equal(rootCalls, 3)
  assert.equal(diffViewer.operationState(), "failed")
  assert.match(diffViewer.render(160).join("\n"), /pull stopped after updating files/u)
})

test("cancelling pull aborts observation and reconciles before completing", async () => {
  const pullResult = deferred<GitExecResult>()
  let pullCalls = 0
  let pullSignal: AbortSignal | undefined
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "pull") {
        pullCalls += 1
        pullSignal = options?.signal
        return pullResult.promise
      }
      return workingSnapshotResult(args) ?? gitResult("", 93, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)
  const command = {
    label: "Pull",
    description: "Pull",
    args: ["pull"],
    refreshDiff: true,
    risk: { kind: "normal" as const },
  }

  const running = diffViewer.runCommand(command)
  await flushViewerWork(2)
  assert.equal(diffViewer.cancel(), true)
  assert.equal(pullSignal?.aborted, true)
  pullResult.resolve(gitResult("Pull complete"))
  await running

  assert.equal(pullCalls, 1)
  assert.equal(rootCalls, 2)
  assert.equal(diffViewer.operationState(), "succeeded")
  assert.equal(diffViewer.overlayStates()[1], "closed")
})

test("Escape during a pending commit reconciles once and never reopens the dialog", async () => {
  const commitResult = deferred<GitExecResult>()
  const fake = commitPi(() => commitResult.promise)
  const diffViewer = viewer(fake.pi)

  const running = diffViewer.commit()
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  assert.equal(fake.state.commitSignal?.aborted, true)
  commitResult.resolve(gitResult("Commit complete"))
  await running

  assert.equal(fake.state.commitCalls, 1)
  assert.equal(fake.state.rootCalls, 2)
  assert.equal(diffViewer.operationState(), "succeeded")
  assert.equal(diffViewer.overlayStates()[4], "closed")
})

test("Escape during a pending stash mutation reconciles once and never reopens the picker", async () => {
  const stashResult = deferred<GitExecResult>()
  let rootCalls = 0
  let stashCalls = 0
  let stashSignal: AbortSignal | undefined
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "stash push -u -m WIP from pi-git-tui") {
        stashCalls += 1
        stashSignal = options?.signal
        return stashResult.promise
      }
      return workingSnapshotResult(args) ?? gitResult("", 91, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  const running = diffViewer.stashCurrent()
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  assert.equal(stashSignal?.aborted, true)
  stashResult.resolve(gitResult("Stashed current changes"))
  await running

  assert.equal(stashCalls, 1)
  assert.equal(rootCalls, 2)
  assert.equal(diffViewer.operationState(), "succeeded")
  assert.equal(diffViewer.overlayStates()[3], "closed")
})

test("discard adapter closes its confirmation after success when refresh fails", async () => {
  const fake = refreshFailingPi(
    (args) => args.join(" ") === "--literal-pathspecs restore --source=HEAD --staged --worktree -- src/file.ts",
    (args) => {
      const command = args.join(" ")
      if (args.includes("ls-tree")) return gitResult("src/file.ts\0")
      if (args.includes("ls-files")) return gitResult()
      if (command === "rev-parse --verify HEAD") return gitResult("abcdef\n")
      if (command === "--literal-pathspecs diff --cached --quiet -- src/file.ts") return gitResult()
      if (command === "--literal-pathspecs diff --quiet -- src/file.ts") return gitResult()
      return
    },
  )
  const diffViewer = viewer(fake.pi)

  await diffViewer.discard()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[2], "closed")
})

test("init adapter closes its confirmation after success when refresh fails", async () => {
  let rootCalls = 0
  let initCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 1) return gitResult("", 128, "fatal: not a git repository")
        if (rootCalls === 3) return gitResult("", 2, "fatal: refresh failed")
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "init") {
        initCalls += 1
        return gitResult("Initialized")
      }
      return gitResult("", 98, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi, true)

  await diffViewer.initialize()

  assert.equal(initCalls, 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[2], "closed")
})

test("stash apply, pop, and drop close after success when refresh fails", async (t) => {
  for (const [label, command, run] of [
    ["apply", "stash apply stash@{0}", (viewer: MutationViewer) => viewer.stashApply()],
    ["pop", "stash pop stash@{0}", (viewer: MutationViewer) => viewer.stashPop()],
    ["drop", "stash drop stash@{0}", (viewer: MutationViewer) => viewer.stashDrop()],
  ] as const) {
    await t.test(label, async () => {
      const fake = refreshFailingPi((args) => args.join(" ") === command)
      const diffViewer = viewer(fake.pi)

      await run(diffViewer)

      assert.equal(fake.mutationCalls(), 1)
      assert.equal(diffViewer.operationState(), "refreshFailed")
      assert.equal(diffViewer.overlayStates()[3], "closed")
    })
  }
})

test("stash pop conflict reconciles the worktree and retains original diagnostics", async () => {
  let popCalls = 0
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "stash pop stash@{0}") {
        popCalls += 1
        return gitResult("Auto-merging src/file.ts", 1, "CONFLICT: stash pop changed the worktree")
      }
      return workingSnapshotResult(args) ?? gitResult("", 90, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  await diffViewer.stashPop()

  assert.equal(popCalls, 1)
  assert.equal(rootCalls, 2)
  assert.equal(diffViewer.operationState(), "failed")
  assert.equal(diffViewer.overlayStates()[3], "open")
  const frame = diffViewer.render(180).join("\n")
  assert.match(frame, /stash pop changed the worktree/u)
  assert.match(frame, /Auto-merging src\/file\.ts/u)
})

test("failed stash-pop reconciliation blocks mutations and r retries only the snapshot", async () => {
  let popCalls = 0
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 2) return gitResult("", 2, "fatal: stash reconciliation unavailable")
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "stash pop stash@{0}") {
        popCalls += 1
        return gitResult("Auto-merging src/file.ts", 1, "CONFLICT: stash pop changed the worktree")
      }
      return workingSnapshotResult(args) ?? gitResult("", 89, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  await diffViewer.stashPop()
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[3], "closed")
  assert.match(diffViewer.render(180).join("\n"), /stash reconciliation unavailable/u)

  await diffViewer.stashPop()
  assert.equal(popCalls, 1)
  await diffViewer.retry()

  assert.equal(popCalls, 1)
  assert.equal(rootCalls, 3)
  assert.equal(diffViewer.operationState(), "failed")
  const frame = diffViewer.render(180).join("\n")
  assert.match(frame, /stash pop changed the worktree/u)
})

test("stash adapter closes after side effect success when refresh fails", async () => {
  const fake = refreshFailingPi((args) => args.join(" ") === "stash push -u -m WIP from pi-git-tui")
  const diffViewer = viewer(fake.pi)

  await diffViewer.stashCurrent()

  assert.equal(fake.mutationCalls(), 1)
  assert.equal(diffViewer.operationState(), "refreshFailed")
  assert.equal(diffViewer.overlayStates()[3], "closed")
})
