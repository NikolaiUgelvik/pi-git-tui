import assert from "node:assert/strict"
import { test } from "node:test"
import { buildCommitDocument, buildWorkingTreeDocument } from "../src/diff-document.js"
import type { DiffFile, WorkingTreeDocument } from "../src/types.js"
import { failedViewerDocument, ViewerDocumentState } from "../src/viewer-document-state.js"

function file(path: string, oldPath?: string, newPath?: string): DiffFile {
  return {
    path,
    oldPath,
    newPath,
    status: oldPath && newPath ? "renamed" : "modified",
    stageState: "unstaged",
    lines: [],
  }
}

function document(files: DiffFile[], title = "Working tree", stagedFiles: DiffFile[] = []): WorkingTreeDocument {
  return buildWorkingTreeDocument({
    title,
    subtitle: "/repo",
    repositoryState: "ready",
    headState: "present",
    workingRaw: "",
    stagedRaw: "",
    workingOmittedFiles: files,
    stagedOmittedFiles: stagedFiles,
  })
}

test("document replacement preserves selection through rename aliases", () => {
  const state = new ViewerDocumentState("/repo", document([file("old.ts"), file("other.ts")]))
  state.selectedFileIndex = 0
  const selection = state.captureSelection()

  state.replaceDocument(
    { kind: "working", cwd: "/repo" },
    document([file("new.ts", "old.ts", "new.ts"), file("other.ts")]),
    selection,
  )

  assert.equal(state.files[state.selectedFileIndex]?.path, "new.ts")
  assert.equal(state.diffScroll, 0)
  assert.equal(state.generation, 1)
})

test("staged and working views preserve the selected logical path", () => {
  const mixedWorking = file("new.ts", "old.ts", "new.ts")
  mixedWorking.stageState = "mixed"
  const mixedStaged = file("old.ts")
  mixedStaged.stageState = "mixed"
  const state = new ViewerDocumentState(
    "/repo",
    document([mixedWorking, file("other.ts")], "Working tree", [mixedStaged]),
  )

  assert.equal(state.setWorkingTreeView("staged"), true)
  assert.equal(state.files[state.selectedFileIndex]?.path, "old.ts")
  assert.equal(state.workingTreeView, "staged")

  assert.equal(state.setWorkingTreeView("working"), true)
  assert.equal(state.files[state.selectedFileIndex]?.path, "new.ts")
})

test("document reload preserves the staged view and rename-aware selection", () => {
  const oldFile = file("old.ts")
  oldFile.stageState = "staged"
  const state = new ViewerDocumentState("/repo", document([], "Working tree", [oldFile]))
  state.setWorkingTreeView("staged")
  const selection = state.captureSelection()
  const renamed = file("new.ts", "old.ts", "new.ts")
  renamed.stageState = "staged"

  state.replaceDocument({ kind: "working", cwd: "/repo" }, document([], "Working tree", [renamed]), selection)

  assert.equal(state.workingTreeView, "staged")
  assert.equal(state.files[state.selectedFileIndex]?.path, "new.ts")
})

test("failed initial load remains distinct from a clean document", () => {
  const request = { kind: "working" as const, cwd: "/repo" }
  const state = new ViewerDocumentState("/repo", failedViewerDocument(request, new Error("git timed out")))

  assert.equal(state.document.title, "Diff unavailable")
  assert.equal(state.failure?.summary, "git timed out")
  assert.deepEqual(state.request, request)
})

test("failed worktree load does not change the active cwd or complete document", () => {
  const initial = document([file("kept.ts")])
  const state = new ViewerDocumentState("/repo-a", initial)
  const failedRequest = { kind: "working" as const, cwd: "/repo-b" }

  state.recordLoadFailure(failedRequest, new Error("cannot load repo-b"))

  assert.equal(state.activeCwd, "/repo-a")
  assert.equal(state.document, initial)
  assert.equal(state.files[0]?.path, "kept.ts")
  assert.deepEqual(state.request, { kind: "working", cwd: "/repo-a" })
  assert.deepEqual(state.reloadRequest, failedRequest)
})

test("accepting a retry promotes its request and clears the failed target", () => {
  const state = new ViewerDocumentState("/repo", document([file("working.ts")]))
  const commit = { hash: "abc123", message: "historical" }
  const failedRequest = { kind: "commit" as const, cwd: "/repo", commit }
  state.recordLoadFailure(failedRequest, new Error("temporary show failure"))
  const historical = buildCommitDocument({
    title: "Commit abc123",
    subtitle: "/repo • historical",
    raw: "",
    commit,
  })

  state.replaceDocument(failedRequest, historical)

  assert.equal(state.document, historical)
  assert.equal(state.failure, undefined)
  assert.deepEqual(state.request, failedRequest)
  assert.deepEqual(state.reloadRequest, failedRequest)
})
