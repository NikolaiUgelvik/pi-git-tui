import assert from "node:assert/strict"
import { test } from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { buildCommitDocument } from "../src/diff-document.js"
import type { DiffFile } from "../src/types.js"
import { prioritizedFooter, viewerFooterActions } from "../src/viewer-footer-actions.js"
import { workingDocument } from "./helpers/viewer.js"

const changedFile: DiffFile = {
  path: "example.ts",
  status: "modified",
  stageState: "unstaged",
  lines: ["diff --git a/example.ts b/example.ts"],
}

test("prioritized footers pin help and limit status controls", () => {
  const footer = prioritizedFooter(
    "The active target could not be refreshed after the operation completed",
    ["r retry target", "W working tree", "? help", "q close"],
    120,
  )

  assert.equal(footer.trimStart().startsWith("? help • "), true)
  assert.match(footer, /The active target could not be refreshed after the operation completed/u)
  assert.match(footer, /r retry target • q close/u)
  assert.doesNotMatch(footer, /W working tree/u)
  assert.ok(visibleWidth(footer.trimEnd()) <= 120)

  const narrow = prioritizedFooter("Refresh failed", ["r retry target", "? help", "q close"], 28)
  assert.match(narrow, /^\? help • .* • q close$/u)
  assert.doesNotMatch(narrow, /retry/u)
})

test("working tree footer shows only file controls while the tree is focused", () => {
  const actions = viewerFooterActions(
    {
      document: workingDocument("/repo", { workingFiles: [changedFile] }),
      focusedPanel: "tree",
      workingTreeView: "working",
    },
    200,
  )

  assert.deepEqual(actions, ["? help", "q close", "↵ stage", "v staged"])
})

test("working tree footer switches to viewport controls while the diff is focused", () => {
  const actions = viewerFooterActions(
    {
      document: workingDocument("/repo", { workingFiles: [changedFile] }),
      focusedPanel: "diff",
      workingTreeView: "working",
    },
    200,
  )

  assert.deepEqual(actions, ["? help", "q close", "↑↓ scroll", "v staged"])
})

test("staged tree footer replaces destructive working controls with commit controls", () => {
  const stagedFile = { ...changedFile, stageState: "staged" as const }
  const actions = viewerFooterActions(
    {
      document: workingDocument("/repo", { stagedFiles: [stagedFile] }),
      focusedPanel: "tree",
      workingTreeView: "staged",
    },
    200,
  )

  assert.deepEqual(actions, ["? help", "q close", "↵ unstage", "C commit"])
})

test("empty and historical footers expose only actions useful in their context", () => {
  const emptyActions = viewerFooterActions(
    {
      document: workingDocument("/repo"),
      focusedPanel: "tree",
      workingTreeView: "working",
    },
    200,
  )
  assert.deepEqual(emptyActions, ["? help", "q close", "v staged", "c commits"])

  const historicalActions = viewerFooterActions(
    {
      document: buildCommitDocument({
        title: "Commit abc123",
        subtitle: "/repo • historical",
        raw: "diff --git a/example.ts b/example.ts",
        commit: { hash: "abc123", message: "historical" },
      }),
      focusedPanel: "tree",
      workingTreeView: "working",
    },
    200,
  )
  assert.deepEqual(historicalActions, ["? help", "q close", "W tree", "c commits"])
})

test("standard footer keeps every high-value action on screen", () => {
  const actions = viewerFooterActions(
    {
      document: workingDocument("/repo", { workingFiles: [changedFile] }),
      focusedPanel: "tree",
      workingTreeView: "working",
    },
    80,
  )

  assert.ok(actions.length <= 4)
  assert.equal(actions[0], "? help")
  assert.ok(actions.includes("v staged"))
})

test("narrow footer keeps help first and fits complete contextual actions", () => {
  const actions = viewerFooterActions(
    {
      document: workingDocument("/repo", { workingFiles: [changedFile] }),
      focusedPanel: "tree",
      workingTreeView: "working",
    },
    30,
  )
  const footer = actions.join(" • ")

  assert.deepEqual(actions, ["? help", "q close", "↵ stage"])
  assert.ok(visibleWidth(footer) <= 30)
})
