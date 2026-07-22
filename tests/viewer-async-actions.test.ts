import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import type { DiffDocument, DiffFile } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import {
  createTempGitRepository,
  createTrackingGitPi,
  runFixtureGit,
  writeRepoFile,
} from "./helpers/temp-git-repository.js"
import { testTheme, testViewerOptions } from "./helpers/viewer.js"

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

function context(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext
}

class AsyncActionViewer extends DiffViewer {
  private acceptedStage: Promise<void> | undefined

  protected override updateSelectedFileStage(file: DiffFile): Promise<void> {
    const wasBusy = this.isOperationBusy()
    const run = super.updateSelectedFileStage(file)
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

  branchSwitch(name: string): Promise<void> {
    return this.runBranchSwitch(name)
  }

  stashCurrent(): Promise<void> {
    return this.runStashCurrent()
  }

  commit(message: string): Promise<void> {
    return this.commitStagedChanges(message)
  }
}

function createViewer(pi: ExtensionAPI, cwd: string, document: DiffDocument): AsyncActionViewer {
  return new AsyncActionViewer(
    pi,
    context(cwd),
    testTheme,
    document,
    () => {},
    () => {},
    () => 80,
    testViewerOptions,
  )
}

test("bursts of stage, stage-all, and branch input launch one mutation and preserve selection", async () => {
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
    viewer.handleInput("\x1b[B")

    await delayed.started
    delayed.release()
    await Promise.all([viewer.waitForStage(), rejectedBranch])

    const finalDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assert.equal(viewer.currentPath(), originalPath)
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
  } finally {
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

    await runFixtureGit(branchRepo.path, ["branch", "feature"])
    const branchDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(branchRepo.path))
    const delayedBranch = createDelayedGitPi((args) => args[0] === "switch")
    const branchViewer = createViewer(delayedBranch.pi, branchRepo.path, branchDocument)
    const switches = [branchViewer.branchSwitch("feature"), branchViewer.branchSwitch("feature")]
    await delayedBranch.started
    delayedBranch.release()
    await Promise.all(switches)
    assert.equal(delayedBranch.calls.filter((call) => call.args[0] === "switch").length, 1)

    await writeRepoFile(stashRepo.path, "tracked.txt", "stash me\n")
    const stashDocument = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(stashRepo.path))
    const delayedStash = createDelayedGitPi((args) => args[0] === "stash" && args[1] === "push")
    const stashViewer = createViewer(delayedStash.pi, stashRepo.path, stashDocument)
    const stashes = [stashViewer.stashCurrent(), stashViewer.stashCurrent()]
    await delayedStash.started
    delayedStash.release()
    await Promise.all(stashes)
    assert.equal(delayedStash.calls.filter((call) => call.args[0] === "stash" && call.args[1] === "push").length, 1)
  } finally {
    await commitRepo.cleanup()
    await branchRepo.cleanup()
    await stashRepo.cleanup()
  }
})
