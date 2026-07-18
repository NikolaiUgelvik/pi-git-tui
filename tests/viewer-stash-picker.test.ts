import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import { flushViewerWork, gitResult, testTheme, workingDocument, workingSnapshotResult } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

class StashTestViewer extends DiffViewer {
  failureDetailsText(): string | undefined {
    return this.currentFailureDetails()?.details
  }
}

function viewer(pi: ExtensionAPI): StashTestViewer {
  return new StashTestViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument(),
    () => {},
    () => {},
    () => 40,
  )
}

test("post-stash list failure keeps prior rows, leaves loading, and r retries only listing", async () => {
  const failedList = deferred<ReturnType<typeof gitResult>>()
  let listCalls = 0
  let stashCalls = 0
  const initialList = "stash@{0}\0previous work\n"
  const refreshedList = "stash@{0}\0newly stashed work\nstash@{1}\0previous work\n"
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "stash list --format=%gd%x00%s") {
        listCalls += 1
        if (listCalls === 1) return gitResult(initialList)
        if (listCalls === 2) return failedList.promise
        return gitResult(refreshedList)
      }
      if (command === "stash push -u -m WIP from pi-git") {
        stashCalls += 1
        return gitResult("Stashed current changes")
      }
      const snapshot = workingSnapshotResult(args, options?.cwd)
      return snapshot ?? gitResult("", 93, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("s")
  await flushViewerWork()
  diffViewer.handleInput("\n")
  await flushViewerWork(8)
  assert.match(diffViewer.render(180).join("\n"), /Refreshing stashes/u)
  failedList.resolve(gitResult("", 2, "fatal: stash list unavailable"))
  await flushViewerWork(8)

  const warningFrame = diffViewer.render(180).join("\n")
  assert.equal(stashCalls, 1)
  assert.equal(listCalls, 2)
  assert.match(warningFrame, /Stash list refresh failed: fatal: stash list unavailable/u)
  assert.match(warningFrame, /previous work/u)
  assert.match(warningFrame, /r retry list/u)
  assert.match(warningFrame, /✓ Stashed current changes/u)
  assert.match(diffViewer.failureDetailsText() ?? "", /Command: git stash list --format=%gd%x00%s/u)
  assert.match(diffViewer.failureDetailsText() ?? "", /fatal: stash list unavailable/u)

  diffViewer.handleInput("r")
  await flushViewerWork()

  const recoveredFrame = diffViewer.render(180).join("\n")
  assert.equal(stashCalls, 1)
  assert.equal(listCalls, 3)
  assert.match(recoveredFrame, /newly stashed work/u)
  assert.doesNotMatch(recoveredFrame, /stash list unavailable/u)
  assert.equal(diffViewer.failureDetailsText(), undefined)
})

test("post-drop list failure keeps prior rows and retry never drops twice", async () => {
  let dropCalls = 0
  let listCalls = 0
  const initialList = "stash@{0}\0previous work\n"
  const refreshedList = "stash@{0}\0older work\n"
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "stash list --format=%gd%x00%s") {
        listCalls += 1
        if (listCalls === 1) return gitResult(initialList)
        if (listCalls === 2) return gitResult("", 2, "fatal: stash list unavailable after drop")
        return gitResult(refreshedList)
      }
      if (command === "stash drop stash@{0}") {
        dropCalls += 1
        return gitResult("Dropped stash@{0}")
      }
      const snapshot = workingSnapshotResult(args, options?.cwd)
      return snapshot ?? gitResult("", 92, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("s")
  await flushViewerWork()
  diffViewer.handleInput("\x1b[B")
  diffViewer.handleInput("\x04")
  diffViewer.handleInput("\n")
  await flushViewerWork(16)

  const warningFrame = diffViewer.render(180).join("\n")
  assert.equal(dropCalls, 1)
  assert.equal(listCalls, 2)
  assert.match(warningFrame, /stash list unavailable after drop/u)
  assert.match(warningFrame, /previous work/u)
  assert.match(warningFrame, /r retry list/u)
  assert.match(warningFrame, /✓ Dropped stash@\{0\}/u)

  diffViewer.handleInput("r")
  await flushViewerWork()

  const recoveredFrame = diffViewer.render(180).join("\n")
  assert.equal(dropCalls, 1)
  assert.equal(listCalls, 3)
  assert.match(recoveredFrame, /older work/u)
  assert.doesNotMatch(recoveredFrame, /stash list unavailable after drop/u)
})

test("cancelling a post-stash list refresh preserves confirmed mutation feedback", async (t) => {
  for (const outcome of ["resolve", "reject"] as const) {
    await t.test(outcome, async () => {
      const pendingList = deferred<ReturnType<typeof gitResult>>()
      let listCalls = 0
      let stashCalls = 0
      const pi = {
        exec: async (_command: string, args: string[], options?: ExecOptions) => {
          const command = args.join(" ")
          if (command === "stash list --format=%gd%x00%s") {
            listCalls += 1
            if (listCalls === 1) return gitResult("stash@{0}\0previous work\n")
            return pendingList.promise
          }
          if (command === "stash push -u -m WIP from pi-git") {
            stashCalls += 1
            return gitResult("Stashed current changes")
          }
          return workingSnapshotResult(args, options?.cwd) ?? gitResult("", 91, `unexpected git ${command}`)
        },
      } as ExtensionAPI
      const diffViewer = viewer(pi)

      diffViewer.handleInput("s")
      await flushViewerWork()
      diffViewer.handleInput("\n")
      await flushViewerWork(8)
      diffViewer.handleInput("\x1b")
      if (outcome === "resolve") {
        pendingList.resolve(gitResult("stash@{0}\0late row\n"))
      } else {
        pendingList.reject(new Error("late list failure"))
      }
      await flushViewerWork(8)

      const frame = diffViewer.render(160).join("\n")
      assert.equal(stashCalls, 1)
      assert.equal(listCalls, 2)
      assert.match(frame, /✓ Stashed current changes/u)
      assert.doesNotMatch(frame, /│ Stashes\s/u)
      assert.doesNotMatch(frame, /late row|late list failure/u)
    })
  }
})

test("Escape closes a pending stash list, aborts it, and late completion cannot reopen it", async () => {
  const pendingList = deferred<ReturnType<typeof gitResult>>()
  let listCalls = 0
  let listSignal: AbortSignal | undefined
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "stash list --format=%gd%x00%s") {
        listCalls += 1
        listSignal = options?.signal
        return pendingList.promise
      }
      const snapshot = workingSnapshotResult(args, options?.cwd)
      return snapshot ?? gitResult("", 94, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("s")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  assert.equal(listSignal?.aborted, true)
  pendingList.resolve(gitResult("stash@{0}\0late stash\n"))
  await flushViewerWork()

  const frame = diffViewer.render(140).join("\n")
  assert.equal(listCalls, 1)
  assert.doesNotMatch(frame, /late stash/u)
  assert.doesNotMatch(frame, /│ Stashes/u)
})

test("Escape closes a pending stash list and late rejection cannot reopen it", async () => {
  const pendingList = deferred<ReturnType<typeof gitResult>>()
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "stash list --format=%gd%x00%s") return pendingList.promise
      const snapshot = workingSnapshotResult(args, options?.cwd)
      return snapshot ?? gitResult("", 95, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("s")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  pendingList.reject(new Error("late stash list failure"))
  await flushViewerWork()

  const frame = diffViewer.render(140).join("\n")
  assert.doesNotMatch(frame, /late stash list failure/u)
  assert.doesNotMatch(frame, /│ Stashes/u)
})
