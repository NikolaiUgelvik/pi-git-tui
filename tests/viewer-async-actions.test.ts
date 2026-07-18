import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import type { BranchSummary, DiffDocument, DiffFile, WorktreeSummary } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

interface ExecOptions {
  cwd?: string
  signal?: AbortSignal
  timeout?: number
}

function createDelayedGitPi(predicate: (args: readonly string[], options: ExecOptions | undefined) => boolean) {
  const tracker = createTrackingGitPi()
  const releaseGate = deferred<void>()
  const started = deferred<void>()
  let delayedCalls = 0

  async function waitForRelease(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (released: boolean) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", abort)
        resolve(released)
      }
      const abort = () => finish(false)
      signal?.addEventListener("abort", abort, { once: true })
      void releaseGate.promise.then(() => finish(true))
    })
  }

  const pi = {
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      const resultPromise = tracker.pi.exec(command, args, options)
      if (!predicate(args, options)) return resultPromise
      delayedCalls++
      started.resolve()
      const result = await resultPromise
      return (await waitForRelease(options?.signal)) ? result : { ...result, killed: true }
    },
  } as unknown as ExtensionAPI

  return {
    pi,
    calls: tracker.calls,
    started: started.promise,
    delayedCalls: () => delayedCalls,
    release: () => releaseGate.resolve(),
  }
}

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

function context(cwd: string, signal = new AbortController().signal): ExtensionContext {
  return { cwd, signal } as ExtensionContext
}

class AsyncActionViewer extends DiffViewer {
  private acceptedStage: Promise<void> | undefined

  protected override toggleSelectedFileStage(file: DiffFile): Promise<void> {
    const wasBusy = this.mutationActive()
    const run = super.toggleSelectedFileStage(file)
    if (!wasBusy) this.acceptedStage = run
    return run
  }

  waitForStage(): Promise<void> {
    if (!this.acceptedStage) throw new Error("No accepted stage operation")
    return this.acceptedStage
  }

  currentPath(): string | undefined {
    return this.document.files[this.selectedFileIndex]?.path
  }

  currentDocument(): DiffDocument {
    return this.document
  }

  currentCwd(): string {
    return this.activePath()
  }

  operationSignal(): AbortSignal {
    return this.viewerSignal
  }

  visibleError(): string | undefined {
    return this.error
  }

  branchSwitch(name: string): Promise<void> {
    return this.runBranchSwitch(name)
  }

  openBranches(): Promise<void> {
    return this.openBranchPicker()
  }

  branches(): readonly BranchSummary[] {
    return this.branchPickerController.list.items
  }

  stashCurrent(): Promise<void> {
    return this.runStashCurrent()
  }

  commit(message: string): Promise<void> {
    return this.commitStagedChanges(message)
  }

  worktree(worktree: WorktreeSummary): Promise<void> {
    return this.switchToWorktree(worktree)
  }

  openWorktrees(): Promise<void> {
    return this.openWorktreePicker()
  }

  worktrees(): readonly WorktreeSummary[] {
    return this.worktreePickerController.list.items
  }
}

function createViewer(
  pi: ExtensionAPI,
  cwd: string,
  document: DiffDocument,
  callbacks: { done?: () => void; render?: () => void } = {},
): AsyncActionViewer {
  return new AsyncActionViewer(
    pi,
    context(cwd),
    theme,
    document,
    callbacks.done ?? (() => {}),
    callbacks.render ?? (() => {}),
    () => 80,
  )
}

test("bursts of stage, stage-all, and branch input launch one mutation and preserve navigation", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "second.txt", "initial second\n")
    await runFixtureGit(repo.path, ["add", "second.txt"])
    await runFixtureGit(repo.path, ["commit", "-m", "add second"])
    await runFixtureGit(repo.path, ["branch", "feature"])
    await writeRepoFile(repo.path, "tracked.txt", "changed first\n")
    await writeRepoFile(repo.path, "second.txt", "changed second\n")
    const initial = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const delayed = createDelayedGitPi((args) => args[0] === "--literal-pathspecs" && args[1] === "add")
    const viewer = createViewer(delayed.pi, repo.path, initial)
    const originalPath = viewer.currentPath()

    viewer.handleInput("\n")
    for (let index = 0; index < 49; index++) viewer.handleInput("\n")
    viewer.handleInput("\x1b[13;2u")
    const rejectedBranch = viewer.branchSwitch("feature")
    viewer.handleInput("j")
    const navigatedPath = viewer.currentPath()

    assert.notEqual(navigatedPath, originalPath)
    await delayed.started
    delayed.release()
    await Promise.all([viewer.waitForStage(), rejectedBranch])

    const finalDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(viewer.currentPath(), navigatedPath)
    assert.deepEqual(viewer.currentDocument(), finalDocument)
    assert.equal(delayed.delayedCalls(), 1)
    assert.equal(
      delayed.calls.filter((call) => call.args[0] === "--literal-pathspecs" && call.args[1] === "add").length,
      1,
    )
    assert.equal(
      delayed.calls.some((call) => call.args.join(" ") === "add --all"),
      false,
    )
    assert.equal(
      delayed.calls.some((call) => call.args[0] === "switch"),
      false,
    )
    assert.equal(
      delayed.calls.filter((call) => call.args.includes("ls-files") && call.args.includes("--stage")).length,
      1,
    )
    assert.equal(delayed.calls.filter((call) => call.args.includes("diff") && call.args.includes("--cached")).length, 0)
  } finally {
    await repo.cleanup()
  }
})

test("closing during delayed staging aborts the operation and starts no refresh", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "changed\n")
    const initial = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const delayed = createDelayedGitPi((args) => args[0] === "--literal-pathspecs" && args[1] === "add")
    let doneCalls = 0
    let renderCalls = 0
    const viewer = createViewer(delayed.pi, repo.path, initial, {
      done: () => doneCalls++,
      render: () => renderCalls++,
    })

    viewer.handleInput("\n")
    await delayed.started
    const callsAtClose = delayed.calls.length
    viewer.handleInput("q")
    await viewer.waitForStage()

    assert.equal(doneCalls, 1)
    assert.equal(viewer.operationSignal().aborted, true)
    assert.equal(delayed.calls.length, callsAtClose)
    assert.equal(delayed.calls.filter((call) => call.args.join(" ") === "rev-parse --show-toplevel").length, 1)
    assert.equal(
      delayed.calls.some((call) => call.startedWithAbortedSignal),
      false,
    )
    const rendersAfterClose = renderCalls
    viewer.handleInput("j")
    assert.equal(renderCalls, rendersAfterClose)
  } finally {
    await repo.cleanup()
  }
})

test("out-of-order worktree loads apply cwd and document from the newest target atomically", async () => {
  const origin = await createTempGitRepository()
  const worktreeA = await createTempGitRepository()
  const worktreeB = await createTempGitRepository()
  try {
    const initial = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(origin.path))
    const delayed = createDelayedGitPi((args, options) => args[0] === "status" && options?.cwd === worktreeA.path)
    const viewer = createViewer(delayed.pi, origin.path, initial)

    const older = viewer.worktree({ path: worktreeA.path, branch: "main" })
    await delayed.started
    assert.equal(viewer.currentCwd(), origin.path)
    const newer = viewer.worktree({ path: worktreeB.path, branch: "main" })
    await newer
    await older

    assert.equal(viewer.currentCwd(), worktreeB.path)
    assert.equal(viewer.currentDocument().subtitle, `${worktreeB.path} (main)`)
    assert.equal(
      delayed.calls
        .filter((call) => call.cwd === worktreeA.path)
        .map((call) => call.args[0])
        .join(","),
      "rev-parse,status",
    )
    assert.deepEqual(
      delayed.calls.filter((call) => call.cwd === worktreeB.path).map((call) => call.args[0]),
      ["rev-parse", "status", "diff"],
    )
  } finally {
    await origin.cleanup()
    await worktreeA.cleanup()
    await worktreeB.cleanup()
  }
})

test("failed commit and branch hooks reconcile the viewer with the actual repository", async () => {
  const commitRepo = await createTempGitRepository()
  const branchRepo = await createTempGitRepository()
  try {
    await writeRepoFile(commitRepo.path, "tracked.txt", "staged commit\n")
    await runFixtureGit(commitRepo.path, ["add", "tracked.txt"])
    const commitDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(commitRepo.path))
    const commitTracker = createTrackingGitPi()
    const commitPi = {
      exec: async (command: string, args: string[], options?: ExecOptions) => {
        if (args[0] === "commit") {
          await writeRepoFile(commitRepo.path, "hook-created.txt", "created before hook failure\n")
          return { stdout: "", stderr: "pre-commit hook failed", code: 1, killed: false }
        }
        return commitTracker.pi.exec(command, args, options)
      },
    } as unknown as ExtensionAPI
    const commitViewer = createViewer(commitPi, commitRepo.path, commitDocument)

    await commitViewer.commit("test: rejected commit")

    const freshCommitDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(commitRepo.path))
    assert.deepEqual(commitViewer.currentDocument(), freshCommitDocument)
    assert.match(commitViewer.visibleError() ?? "", /pre-commit hook failed/u)
    assert.equal(commitTracker.calls.filter((call) => call.args[0] === "status").length, 1)

    await runFixtureGit(branchRepo.path, ["branch", "feature"])
    const branchDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(branchRepo.path))
    const branchTracker = createTrackingGitPi()
    const branchPi = {
      exec: async (command: string, args: string[], options?: ExecOptions) => {
        const result = await branchTracker.pi.exec(command, args, options)
        return args[0] === "switch"
          ? { ...result, stderr: "post-checkout hook failed", code: 1, killed: false }
          : result
      },
    } as unknown as ExtensionAPI
    const branchViewer = createViewer(branchPi, branchRepo.path, branchDocument)
    await branchViewer.openBranches()

    await branchViewer.branchSwitch("feature")

    const freshBranchDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(branchRepo.path))
    assert.deepEqual(branchViewer.currentDocument(), freshBranchDocument)
    assert.equal(branchViewer.currentDocument().subtitle, `${branchRepo.path} (feature)`)
    assert.match(branchViewer.visibleError() ?? "", /post-checkout hook failed/u)
    assert.equal(branchViewer.branches().find((branch) => branch.name === "feature")?.current, true)
    assert.equal(branchViewer.branches().find((branch) => branch.name === "main")?.current, false)
    assert.equal(branchTracker.calls.filter((call) => call.args[0] === "switch").length, 1)
  } finally {
    await commitRepo.cleanup()
    await branchRepo.cleanup()
  }
})

test("a removed worktree is not left selectable after a failed switch", async () => {
  const repo = await createTempGitRepository()
  const linkedPath = `${repo.path}-removed-worktree`
  try {
    await runFixtureGit(repo.path, ["branch", "feature"])
    await runFixtureGit(repo.path, ["worktree", "add", linkedPath, "feature"])
    const initial = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const viewer = createViewer(createTrackingGitPi().pi, repo.path, initial)
    await viewer.openWorktrees()
    const removed = viewer.worktrees().find((worktree) => worktree.path === linkedPath)
    assert.ok(removed)
    await runFixtureGit(repo.path, ["worktree", "remove", "--force", linkedPath])

    await viewer.worktree(removed)

    assert.match(viewer.visibleError() ?? "", /no longer available|failed|ENOENT|spawn/iu)
    assert.equal(
      viewer.worktrees().some((worktree) => worktree.path === linkedPath),
      false,
    )
  } finally {
    await runFixtureGit(repo.path, ["worktree", "remove", "--force", linkedPath]).catch(() => undefined)
    await repo.cleanup()
  }
})

test("commit, branch, and stash action duplicates each start one Git mutation", async () => {
  const commitRepo = await createTempGitRepository()
  const branchRepo = await createTempGitRepository()
  const stashRepo = await createTempGitRepository()
  try {
    await writeRepoFile(commitRepo.path, "tracked.txt", "staged commit\n")
    await runFixtureGit(commitRepo.path, ["add", "tracked.txt"])
    const commitDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(commitRepo.path))
    const delayedCommit = createDelayedGitPi((args) => args[0] === "commit")
    const commitViewer = createViewer(delayedCommit.pi, commitRepo.path, commitDocument)
    const commits = [commitViewer.commit("test: coordinated commit"), commitViewer.commit("test: duplicate")]
    await delayedCommit.started
    delayedCommit.release()
    await Promise.all(commits)
    assert.equal(delayedCommit.calls.filter((call) => call.args[0] === "commit").length, 1)
    assert.equal(
      (await runFixtureGit(commitRepo.path, ["log", "-1", "--pretty=%s"])).trim(),
      "test: coordinated commit",
    )

    await runFixtureGit(branchRepo.path, ["branch", "feature"])
    const branchDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(branchRepo.path))
    const delayedBranch = createDelayedGitPi((args) => args[0] === "switch")
    const branchViewer = createViewer(delayedBranch.pi, branchRepo.path, branchDocument)
    const switches = [branchViewer.branchSwitch("feature"), branchViewer.branchSwitch("feature")]
    await delayedBranch.started
    delayedBranch.release()
    await Promise.all(switches)
    assert.equal(delayedBranch.calls.filter((call) => call.args[0] === "switch").length, 1)
    assert.equal(branchViewer.currentDocument().subtitle, `${branchRepo.path} (feature)`)

    await writeRepoFile(stashRepo.path, "tracked.txt", "stash me\n")
    const stashDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(stashRepo.path))
    const delayedStash = createDelayedGitPi((args) => args[0] === "stash" && args[1] === "push")
    const stashViewer = createViewer(delayedStash.pi, stashRepo.path, stashDocument)
    const stashes = [stashViewer.stashCurrent(), stashViewer.stashCurrent()]
    await delayedStash.started
    delayedStash.release()
    await Promise.all(stashes)
    assert.equal(delayedStash.calls.filter((call) => call.args[0] === "stash" && call.args[1] === "push").length, 1)
    assert.deepEqual(stashViewer.currentDocument().files, [])
  } finally {
    await commitRepo.cleanup()
    await branchRepo.cleanup()
    await stashRepo.cleanup()
  }
})
