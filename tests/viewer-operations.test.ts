import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { DiffFile } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import {
  flushViewerWork,
  gitResult,
  testTheme,
  testViewerOptions,
  workingDocument,
  workingSnapshotResult,
} from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

class GeneratedMessageViewer extends DiffViewer {
  readonly generated = deferred<string>()
  generationSignal: AbortSignal | undefined

  protected override requestGeneratedCommitMessage(signal: AbortSignal): Promise<string> {
    this.generationSignal = signal
    return this.generated.promise
  }

  dialogState(): string {
    return this.commitDialogState
  }

  message(): string {
    return this.commitMessage
  }
}

class BusyOperationViewer extends DiffViewer {
  readonly mutation = deferred<string>()
  readonly reconciliation = deferred<string>()

  startMutation() {
    return this.runMutation({
      label: "pull",
      runningMessage: "Pulling…",
      mutate: () => this.mutation.promise,
      successMessage: (message) => message,
      refresh: {
        label: "diff refresh",
        run: () => this.reconciliation.promise,
        apply: () => {},
      },
    })
  }

  overlayStates(): string[] {
    return [
      this.branchState,
      this.stashState,
      this.worktreeState,
      this.pickerState,
      this.commitDialogState,
      this.commandMenuState,
    ]
  }

  state(): string {
    return this.operationSnapshot().state
  }
}

const stagedFile: DiffFile = {
  path: "staged.ts",
  status: "modified",
  stageState: "staged",
  lines: ["diff --git a/staged.ts b/staged.ts", "@@ -1 +1 @@", "-old", "+new"],
}

function stagedDocument() {
  return workingDocument("/repo", { stagedFiles: [stagedFile] })
}

function generatedMessageViewer(): GeneratedMessageViewer {
  return new GeneratedMessageViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    stagedDocument(),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
}

test("feature overlays stay closed during mutation cancellation and reconciliation", async () => {
  const viewer = new BusyOperationViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument(),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
  const running = viewer.startMutation()
  for (const input of ["b", "s", "w", "c", "C", "\x10"]) {
    viewer.handleInput(input)
  }
  assert.deepEqual(viewer.overlayStates(), ["closed", "closed", "closed", "closed", "closed", "closed"])

  viewer.handleInput("\x1b")
  viewer.mutation.resolve("Pull complete")
  await flushViewerWork(2)
  assert.equal(viewer.state(), "reconciling")
  for (const input of ["b", "s", "w", "c", "C", "\x10"]) {
    viewer.handleInput(input)
  }
  assert.deepEqual(viewer.overlayStates(), ["closed", "closed", "closed", "closed", "closed", "closed"])

  viewer.reconciliation.resolve("current document")
  const outcome = await running
  assert.equal(outcome.kind, "cancelled")
  assert.equal(viewer.state(), "succeeded")
})

test("successful commit plus failed refresh closes submission and r retries only refresh", async () => {
  let commitCalls = 0
  let rootCalls = 0
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 2) {
          return gitResult("", 2, "fatal: snapshot temporarily unavailable")
        }
        return gitResult(`${options?.cwd ?? "/repo"}\n`)
      }
      if (command === "diff --cached --quiet --") return gitResult("", 1)
      if (command === "commit -m fix") {
        commitCalls += 1
        return gitResult("Commit complete")
      }
      return workingSnapshotResult(args, options?.cwd) ?? gitResult("", 91, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const viewer = new DiffViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    stagedDocument(),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )

  viewer.handleInput("C")
  viewer.handleInput("C")
  viewer.handleInput("f")
  viewer.handleInput("i")
  viewer.handleInput("x")
  viewer.handleInput("\n")
  await flushViewerWork()

  const failedRefreshFrame = viewer.render(180).join("\n")
  assert.equal(commitCalls, 1)
  assert.match(failedRefreshFrame, /Commit complete/u)
  assert.match(failedRefreshFrame, /Action succeeded; diff refresh failed/u)
  assert.doesNotMatch(failedRefreshFrame, /Message: fix/u)

  viewer.handleInput("C")
  viewer.handleInput("\n")
  await flushViewerWork(2)
  assert.equal(commitCalls, 1)

  viewer.handleInput("r")
  await flushViewerWork()

  assert.equal(commitCalls, 1)
  assert.equal(rootCalls, 3)
  assert.match(viewer.render(180).join("\n"), /✓ Commit complete/u)
})

test("Escape aborts generation and a late message cannot repopulate the closed dialog", async () => {
  const viewer = generatedMessageViewer()
  viewer.handleInput("C")
  viewer.handleInput("C")
  for (const character of "draft") {
    viewer.handleInput(character)
  }
  viewer.handleInput("\x07")

  viewer.handleInput("\x1b")
  assert.equal(viewer.generationSignal?.aborted, true)
  assert.equal(viewer.dialogState(), "closed")
  viewer.generated.resolve("fix: late generated message")
  await flushViewerWork()

  assert.equal(viewer.dialogState(), "closed")
  assert.equal(viewer.message(), "draft")
  viewer.handleInput("C")
  assert.match(viewer.render(140).join("\n"), /Message: draft/u)
  assert.doesNotMatch(viewer.render(140).join("\n"), /late generated/u)
})

test("a late generation rejection after Escape does not surface as a dialog error", async () => {
  const viewer = generatedMessageViewer()
  viewer.handleInput("C")
  viewer.handleInput("C")
  viewer.handleInput("\x07")
  viewer.handleInput("\x1b")
  viewer.generated.reject(new Error("late provider failure"))
  await flushViewerWork()

  viewer.handleInput("C")
  const frame = viewer.render(140).join("\n")
  assert.equal(viewer.dialogState(), "open")
  assert.doesNotMatch(frame, /late provider failure/u)
})

test("cancelled worktree load cannot replace the active cwd when it completes late", async () => {
  const targetRoot = deferred<ReturnType<typeof gitResult>>()
  const worktrees = [
    "worktree /repo-main",
    "HEAD abcdef0",
    "branch refs/heads/main",
    "",
    "worktree /repo-feature",
    "HEAD 1234567",
    "branch refs/heads/feature",
    "",
  ].join("\n")
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      const cwd = options?.cwd ?? ""
      if (command === "rev-parse --show-toplevel" && cwd === "/repo-feature") {
        return targetRoot.promise
      }
      if (command === "rev-parse --show-toplevel") return gitResult(`${cwd}\n`)
      if (command === "worktree list --porcelain") return gitResult(worktrees)
      return (
        workingSnapshotResult(args, cwd, { branch: "feature", head: "1234567" }) ??
        gitResult("", 92, `unexpected git ${command}`)
      )
    },
  } as ExtensionAPI
  const context = Object.freeze({ cwd: "/repo-main" }) as ExtensionContext
  const viewer = new DiffViewer(
    pi,
    context,
    testTheme,
    workingDocument("/repo-main"),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )

  viewer.handleInput("w")
  await flushViewerWork()
  viewer.handleInput("feature")
  viewer.handleInput("\n")
  await flushViewerWork(2)
  viewer.handleInput("\x1b")
  targetRoot.resolve(gitResult("/repo-feature\n"))
  await flushViewerWork()

  const frame = viewer.render(140).join("\n")
  assert.equal(context.cwd, "/repo-main")
  assert.match(frame, /\/repo-main \(main\)/u)
  assert.doesNotMatch(frame, /\/repo-feature \(feature\)/u)
  assert.doesNotMatch(frame, / Worktrees\s/u)
})
