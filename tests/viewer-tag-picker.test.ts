import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument } from "../src/diff-document.js"
import type { DiffDocument } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import { flushViewerWork, gitResult, testTheme, testViewerOptions, workingDocument } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

function tagRow(fields: string[]): string {
  return fields.join("\0")
}

const initialTags = `${tagRow([
  "nightly",
  "commit",
  "abc1234",
  "",
  "",
  "2026-07-23",
  "",
  "Alice",
  "",
  "Add tags",
  "",
])}\n`

const refreshedTags = `${tagRow([
  "v2.0.0",
  "tag",
  "tag0001",
  "commit",
  "def5678",
  "2026-07-24",
  "Release Bot",
  "",
  "Bob",
  "Version two",
  "Prepare release",
])}\n${initialTags}`

function viewer(pi: ExtensionAPI, document: DiffDocument = workingDocument()): DiffViewer {
  return new DiffViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    document,
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
}

test("t browses tag metadata and creates an annotated tag at a searched commit", async () => {
  let listCalls = 0
  const tagCommands: string[][] = []
  const pi = {
    exec: async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") {
        listCalls += 1
        return gitResult(listCalls === 1 ? initialTags : refreshedTags)
      }
      if (args[0] === "log") return gitResult("abc1234\tAdd tags\ndef5678\tPrepare release")
      if (args[0] === "tag") {
        tagCommands.push(args)
        return gitResult()
      }
      return gitResult("", 91, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork()
  const list = diffViewer.render(180).join("\n")
  assert.match(list, /Tags/u)
  assert.match(list, /nightly/u)
  assert.match(list, /lightweight/u)
  assert.match(list, /abc1234/u)
  assert.match(list, /Alice/u)
  assert.match(list, /Add tags/u)

  diffViewer.handleInput("\x1bOP")
  assert.match(diffViewer.render(180).join("\n"), /Tag picker help/u)
  diffViewer.handleInput("\x1bOP")

  diffViewer.handleInput("\x0e")
  await flushViewerWork()
  assert.match(diffViewer.render(180).join("\n"), /Select tag target/u)
  diffViewer.handleInput("release")
  diffViewer.handleInput("\r")
  assert.match(diffViewer.render(180).join("\n"), /Create tag at def5678/u)
  diffViewer.handleInput("\x14")
  diffViewer.handleInput("v2.0.0")
  diffViewer.handleInput("\t")
  diffViewer.handleInput("Version two")
  diffViewer.handleInput("\r")
  await flushViewerWork()

  assert.deepEqual(tagCommands, [["tag", "-a", "-m", "Version two", "--", "v2.0.0", "def5678"]])
  assert.equal(listCalls, 2)
  const refreshed = diffViewer.render(180).join("\n")
  assert.match(refreshed, /v2\.0\.0/u)
  assert.match(refreshed, /annotated/u)
  assert.match(refreshed, /Version two/u)
  assert.match(refreshed, /Created annotated tag v2\.0\.0 at def5678/u)
})

test("Enter reports a tag that does not target a commit", async () => {
  const treeTag = `${tagRow(["files", "tree", "abc1234", "", "", "2026-07-23", "", "", "", "", ""])}\n`
  const pi = {
    exec: async () => gitResult(treeTag),
  } as unknown as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork()
  diffViewer.handleInput("\r")
  await flushViewerWork()

  assert.match(diffViewer.render(160).join("\n"), /files points to a tree, not a commit/u)
})

test("historical mode can browse tags and includes the displayed commit as a creation target", async () => {
  const pi = {
    exec: async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") return gitResult(initialTags)
      if (args[0] === "log") return gitResult("abc1234\tAdd tags")
      return gitResult("", 95, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const historical = buildCommitDocument({
    title: "Commit old9999",
    subtitle: "/repo • archived",
    raw: "",
    commit: { hash: "old9999", message: "Archived commit" },
  })
  const diffViewer = viewer(pi, historical)

  diffViewer.handleInput("t")
  await flushViewerWork()
  assert.match(diffViewer.render(160).join("\n"), /nightly/u)
  diffViewer.handleInput("\x0e")
  await flushViewerWork()

  const targets = diffViewer.render(160).join("\n")
  assert.match(targets, /old9999.*Archived commit/u)
  assert.match(targets, /abc1234.*Add tags/u)
})

test("failed post-create tag refresh retries only the tag list", async () => {
  let listCalls = 0
  let tagCalls = 0
  const pi = {
    exec: async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") {
        listCalls += 1
        if (listCalls === 1) return gitResult(initialTags)
        if (listCalls === 2) return gitResult("", 2, "tag refs temporarily unavailable")
        return gitResult(refreshedTags)
      }
      if (args[0] === "log") return gitResult("def5678\tPrepare release")
      if (args[0] === "tag") {
        tagCalls += 1
        return gitResult()
      }
      return gitResult("", 94, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork()
  diffViewer.handleInput("\x0e")
  await flushViewerWork()
  diffViewer.handleInput("\r")
  diffViewer.handleInput("v2.0.0")
  diffViewer.handleInput("\r")
  await flushViewerWork()

  assert.equal(tagCalls, 1)
  assert.equal(listCalls, 2)
  assert.match(diffViewer.render(160).join("\n"), /Action succeeded; tag list refresh failed/u)

  diffViewer.handleInput("r")
  await flushViewerWork()
  assert.equal(tagCalls, 1)
  assert.equal(listCalls, 3)
  assert.match(diffViewer.render(160).join("\n"), /Created lightweight tag v2\.0\.0 at def5678/u)
})

test("creation cancellation reconciles tag rows instead of refreshing the diff", async () => {
  const pendingTag = deferred<ReturnType<typeof gitResult>>()
  let listCalls = 0
  let tagSignal: AbortSignal | undefined
  const reconciledTags = `${tagRow([
    "snapshot2",
    "commit",
    "abc1234",
    "",
    "",
    "2026-07-24",
    "",
    "Alice",
    "",
    "Add tags",
    "",
  ])}\n${initialTags}`
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      if (args[0] === "for-each-ref") {
        listCalls += 1
        return gitResult(listCalls === 1 ? initialTags : reconciledTags)
      }
      if (args[0] === "log") return gitResult("abc1234\tAdd tags")
      if (args[0] === "tag") {
        tagSignal = options?.signal
        return pendingTag.promise
      }
      return gitResult("", 93, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork()
  diffViewer.handleInput("\x0e")
  await flushViewerWork()
  diffViewer.handleInput("\r")
  diffViewer.handleInput("snapshot2")
  diffViewer.handleInput("\r")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  assert.equal(tagSignal?.aborted, true)
  pendingTag.resolve(gitResult())
  await flushViewerWork()

  assert.equal(listCalls, 2)
  const frame = diffViewer.render(160).join("\n")
  assert.match(frame, /snapshot2/u)
  assert.match(frame, /lightweight/u)
  assert.doesNotMatch(frame, /Create tag at/u)
})

async function assertBackedOutCreationLoadStaysCancelled(lateOutcome: "resolve" | "reject"): Promise<void> {
  const pending = deferred<ReturnType<typeof gitResult>>()
  let logCalls = 0
  let pendingSignal: AbortSignal | undefined
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      if (args[0] === "for-each-ref") return gitResult(initialTags)
      if (args[0] === "log") {
        logCalls += 1
        if (logCalls === 1) return gitResult("abc1234\tAdd tags")
        pendingSignal = options?.signal
        return pending.promise
      }
      return gitResult("", 90, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork()
  diffViewer.handleInput("\x0e")
  await flushViewerWork()
  diffViewer.handleInput("\r")
  diffViewer.handleInput("\x1b")
  diffViewer.handleInput("\x1b")

  diffViewer.handleInput("\x0e")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")

  assert.equal(pendingSignal?.aborted, true)
  const cancelledFrame = diffViewer.render(140).join("\n")
  assert.match(cancelledFrame, /│ Tags/u)
  assert.doesNotMatch(cancelledFrame, /Cancelling tag creation|Loading target commits/u)

  if (lateOutcome === "resolve") pending.resolve(gitResult("def5678\tPrepare release"))
  else pending.reject(new Error("late target failure"))
  await flushViewerWork()

  const settledFrame = diffViewer.render(140).join("\n")
  assert.match(settledFrame, /│ Tags/u)
  assert.doesNotMatch(settledFrame, /Select tag target|late target failure/u)
}

test("backing out of tag creation lets Escape cancel a later target load before late resolution", async () => {
  await assertBackedOutCreationLoadStaysCancelled("resolve")
})

test("backing out of tag creation lets Escape cancel a later target load before late rejection", async () => {
  await assertBackedOutCreationLoadStaysCancelled("reject")
})

test("Escape cancels a pending tag list and late completion cannot reopen it", async () => {
  const pending = deferred<ReturnType<typeof gitResult>>()
  let listSignal: AbortSignal | undefined
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      if (args.join(" ") === "rev-parse --show-toplevel") return gitResult("/repo\n")
      if (args[0] === "for-each-ref") {
        listSignal = options?.signal
        return pending.promise
      }
      return gitResult("", 92, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  assert.equal(listSignal?.aborted, true)
  pending.resolve(gitResult(initialTags))
  await flushViewerWork()

  const frame = diffViewer.render(140).join("\n")
  assert.doesNotMatch(frame, /nightly/u)
  assert.doesNotMatch(frame, /│ Tags/u)
})

test("Escape cancels a pending tag list and late rejection cannot reopen it", async () => {
  const pending = deferred<ReturnType<typeof gitResult>>()
  const pi = {
    exec: async (_command: string, args: string[]) => {
      if (args[0] === "for-each-ref") return pending.promise
      return gitResult("", 91, `unexpected git ${args.join(" ")}`)
    },
  } as ExtensionAPI
  const diffViewer = viewer(pi)

  diffViewer.handleInput("t")
  await flushViewerWork(2)
  diffViewer.handleInput("\x1b")
  pending.reject(new Error("late tag list failure"))
  await flushViewerWork()

  const frame = diffViewer.render(140).join("\n")
  assert.doesNotMatch(frame, /Tags|late tag list failure/u)
})
