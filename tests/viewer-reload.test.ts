import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument } from "../src/diff-document.js"
import { openDiffViewer } from "../src/extension.js"
import type { DiffDocument, DiffFile } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import { flushViewerWork, gitResult, testTheme, workingDocument, workingSnapshotResult } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

async function openWithPi(pi: ExtensionAPI): Promise<DiffViewer> {
  let component: DiffViewer | undefined
  const context = {
    cwd: "/repo",
    hasUI: true,
    ui: {
      custom: async (factory: (...args: never[]) => DiffViewer) => {
        component = factory(
          { requestRender: () => {}, terminal: { rows: 40 } } as never,
          testTheme as never,
          {} as never,
          (() => {}) as never,
        )
      },
    },
  } as unknown as ExtensionContext
  await openDiffViewer(pi, context)
  assert.ok(component)
  return component
}

function file(path: string): DiffFile {
  return { path, status: "modified", stageState: "unstaged", lines: [] }
}

class InspectableViewer extends DiffViewer {
  selectedPath(): string | undefined {
    return this.files[this.selectedFileIndex]?.path
  }

  focus(): string {
    return this.focusedPanel
  }

  currentDocument(): DiffDocument {
    return this.document
  }

  picker(): string {
    return this.pickerState
  }
}

test("startup failure renders an explicit retryable failure, not a clean tree", async () => {
  const pi = {
    exec: async () => gitResult("", 2, "fatal: cannot read repository metadata"),
  } as unknown as ExtensionAPI

  const viewer = await openWithPi(pi)
  const frame = viewer.render(160).join("\n")

  assert.match(frame, /Diff unavailable/u)
  assert.match(frame, /cannot read repository metadata/u)
  assert.match(frame, /r retry/u)
  assert.doesNotMatch(frame, /Working tree is clean/u)
})

test("startup failure blocks mutation overlays until the document reloads", async () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("", 2, "fatal: cannot read repository metadata")
    },
  } as unknown as ExtensionAPI
  const viewer = await openWithPi(pi)

  for (const input of ["C", "b", "s", "w", "\x10", "\n"]) {
    viewer.handleInput(input)
  }
  await flushViewerWork(2)

  const frame = viewer.render(160).join("\n")
  assert.equal(execCalls, 1)
  assert.doesNotMatch(frame, /Commit staged changes/u)
  assert.doesNotMatch(frame, /│ Branches\s/u)
  assert.doesNotMatch(frame, /│ Stashes\s/u)
  assert.match(frame, /r retry/u)
})

test("r recovers the same viewer from a startup load failure", async () => {
  let rootCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      if (args.join(" ") === "rev-parse --show-toplevel") {
        rootCalls += 1
        if (rootCalls === 1) return gitResult("", 2, "fatal: transient snapshot error")
      }
      return workingSnapshotResult(args, options?.cwd) ?? gitResult("", 96, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const viewer = await openWithPi(pi)

  viewer.handleInput("r")
  await flushViewerWork()

  const frame = viewer.render(160).join("\n")
  assert.equal(rootCalls, 2)
  assert.match(frame, /Working tree and index/u)
  assert.match(frame, /Working tree is clean/u)
  assert.match(frame, /✓ Diff reloaded/u)
  assert.doesNotMatch(frame, /transient snapshot error/u)
})

test("manual reload preserves active panel and selected path through a rename", async () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/b.ts b/c.ts",
    "similarity index 100%",
    "rename from b.ts",
    "rename to c.ts",
  ].join("\n")
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) =>
      workingSnapshotResult(args, options?.cwd, { workingDiff: diff }) ??
      gitResult("", 95, `unexpected git ${args.join(" ")}`),
  } as ExtensionAPI
  const viewer = new InspectableViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: [file("a.ts"), file("b.ts")] }),
    () => {},
    () => {},
    () => 40,
  )
  viewer.handleInput("\x1b[B")
  viewer.handleInput("\t")

  viewer.handleInput("r")
  await flushViewerWork()

  assert.equal(viewer.focus(), "diff")
  assert.equal(viewer.selectedPath(), "c.ts")
})

test("r reloads the active historical commit rather than the working tree", async () => {
  let showCalls = 0
  const commit = { hash: "abc123", message: "historical change" }
  const diff = [
    "diff --git a/history.ts b/history.ts",
    "--- a/history.ts",
    "+++ b/history.ts",
    "@@ -1 +1 @@",
    "-old",
    "+historical",
  ].join("\n")
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") return gitResult(`${options?.cwd ?? "/repo"}\n`)
      if (command === "rev-parse --verify HEAD") return gitResult("abcdef\n")
      if (command === "branch --show-current") return gitResult("main\n")
      if (args.includes("show") && args.includes(commit.hash)) {
        showCalls += 1
        return gitResult(diff)
      }
      return gitResult("", 93, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const viewer = new InspectableViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    buildCommitDocument({
      title: "Commit abc123",
      subtitle: "/repo • historical change",
      raw: "diff --git a/history.ts b/history.ts",
      commit,
    }),
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("r")
  await flushViewerWork()

  assert.equal(showCalls, 1)
  const current = viewer.currentDocument()
  assert.equal(current.mode, "commit")
  assert.equal(current.mode === "commit" ? current.commit.hash : undefined, "abc123")
  assert.equal(viewer.selectedPath(), "history.ts")
})

test("r retries a failed historical selection instead of reloading the previous document", async () => {
  const commit = { hash: "abc123", message: "historical change" }
  const historicalDiff = [
    "diff --git a/history.ts b/history.ts",
    "--- a/history.ts",
    "+++ b/history.ts",
    "@@ -1 +1 @@",
    "-old",
    "+historical",
  ].join("\n")
  let showCalls = 0
  let workingDiffCalls = 0
  const pi = {
    // fallow-ignore-next-line complexity
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "rev-parse --show-toplevel") return gitResult(`${options?.cwd ?? "/repo"}\n`)
      if (command === "log --max-count=200 --pretty=format:%h%x09%s") {
        return gitResult(`${commit.hash}\t${commit.message}\n`)
      }
      if (command === "rev-parse --verify HEAD") return gitResult("abcdef\n")
      if (command === "branch --show-current") return gitResult("main\n")
      if (args.includes("show") && args.includes(commit.hash)) {
        showCalls += 1
        return showCalls === 1 ? gitResult("", 2, "fatal: temporary object read failure") : gitResult(historicalDiff)
      }
      if (args.includes("diff")) {
        workingDiffCalls += 1
        return gitResult()
      }
      return gitResult("", 92, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const viewer = new InspectableViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument(),
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("c")
  await flushViewerWork()
  viewer.handleInput("\x1b[B")
  viewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(showCalls, 1)
  assert.match(viewer.render(160).join("\n"), /temporary object read failure/u)

  viewer.handleInput("r")
  await flushViewerWork()

  assert.equal(showCalls, 2)
  assert.equal(workingDiffCalls, 0)
  const current = viewer.currentDocument()
  assert.equal(current.mode, "commit")
  assert.equal(current.mode === "commit" ? current.commit.hash : undefined, commit.hash)
})

test("a permanent historical-load failure can reopen history or be abandoned with W", async () => {
  const commit = { hash: "abc123", message: "historical change" }
  let logCalls = 0
  let showCalls = 0
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const command = args.join(" ")
      if (command === "log --max-count=200 --pretty=format:%h%x09%s") {
        logCalls += 1
        return gitResult(`${commit.hash}\t${commit.message}\n`)
      }
      if (command === "rev-parse --show-toplevel") return gitResult(`${options?.cwd ?? "/repo"}\n`)
      if (command === "rev-parse --verify HEAD") return gitResult("abcdef\n")
      if (command === "branch --show-current") return gitResult("main\n")
      if (args.includes("show") && args.includes(commit.hash)) {
        showCalls += 1
        return gitResult("", 2, "fatal: permanent historical read failure")
      }
      return gitResult("", 91, `unexpected git ${command}`)
    },
  } as ExtensionAPI
  const viewer = new InspectableViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: [file("working.ts")] }),
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("c")
  await flushViewerWork()
  viewer.handleInput("\x1b[B")
  viewer.handleInput("\n")
  await flushViewerWork()

  assert.equal(showCalls, 1)
  assert.equal(viewer.currentDocument().mode, "working")
  assert.equal(viewer.selectedPath(), "working.ts")
  assert.match(viewer.render(160).join("\n"), /permanent historical read failure/u)

  viewer.handleInput("c")
  await flushViewerWork()
  assert.equal(logCalls, 2)
  assert.equal(viewer.picker(), "open")
  viewer.handleInput("\x1b")

  viewer.handleInput("W")
  await flushViewerWork()
  assert.equal(showCalls, 1)
  assert.equal(viewer.currentDocument().mode, "working")
  assert.equal(viewer.selectedPath(), "working.ts")
  assert.doesNotMatch(viewer.render(160).join("\n"), /permanent historical read failure/u)
})

test("failed manual reload retains the last complete document and exposes full stderr", async () => {
  const pi = {
    exec: async () =>
      gitResult(
        "partial stdout that must remain inspectable",
        2,
        "fatal: detailed snapshot failure\nsecond diagnostic line",
      ),
  } as unknown as ExtensionAPI
  const initial = workingDocument("/repo", { workingFiles: [file("kept.ts")] })
  const viewer = new InspectableViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    initial,
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("r")
  await flushViewerWork()

  const frame = viewer.render(180).join("\n")
  assert.equal(viewer.currentDocument(), initial)
  assert.equal(viewer.selectedPath(), "kept.ts")
  assert.match(frame, /partial stdout that must remain inspectable/u)
  assert.match(frame, /second diagnostic line/u)
  assert.match(frame, /Command: git rev-parse --show-toplevel/u)
})

test("full failure details remain vertically reachable", async () => {
  const diagnostics = Array.from({ length: 40 }, (_value, index) => `diagnostic-${index}`).join("\n")
  const pi = {
    exec: async () => gitResult("", 2, diagnostics),
  } as unknown as ExtensionAPI
  const viewer = new DiffViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument(),
    () => {},
    () => {},
    () => 12,
  )

  viewer.handleInput("r")
  await flushViewerWork()
  assert.match(viewer.render(100).join("\n"), /diagnostic-0/u)

  viewer.handleInput("\t")
  for (let index = 0; index < 30; index += 1) {
    viewer.handleInput("\x1b[6~")
  }

  const scrolled = viewer.render(100).join("\n")
  assert.match(scrolled, /diagnostic-39/u)
})

test("reload progress is neutral and only completion renders a check mark", async () => {
  const root = deferred<ReturnType<typeof gitResult>>()
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      if (args.join(" ") === "rev-parse --show-toplevel") return root.promise
      return workingSnapshotResult(args, options?.cwd) ?? gitResult("", 94, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const viewer = new DiffViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument(),
    () => {},
    () => {},
    () => 40,
  )

  viewer.handleInput("r")
  await flushViewerWork(2)
  const loadingFooter = viewer.render(140).join("\n")
  assert.match(loadingFooter, /… Reloading diff/u)
  assert.doesNotMatch(loadingFooter, /✓ Reloading diff/u)

  root.resolve(gitResult("/repo\n"))
  await flushViewerWork()
  assert.match(viewer.render(140).join("\n"), /✓ Diff reloaded/u)
})
