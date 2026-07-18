import assert from "node:assert/strict"
import { test } from "node:test"
import { formatDiffDisplay } from "../src/diff-display.js"
import { omittedDiffFile } from "../src/diff-omission.js"
import { buildDocument, emptyDocument } from "../src/diff-parser.js"
import { buildTreeRows } from "../src/tree.js"

test("empty and parsed documents expose capture metrics", () => {
  const empty = emptyDocument("Empty", "repo", "working")
  assert.deepEqual(
    {
      omitted: empty.omittedFileCount,
      bytes: empty.capturedPatchBytes,
      lines: empty.capturedPatchLines,
    },
    { omitted: 0, bytes: 0, lines: 0 },
  )

  const raw = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
  const parsed = buildDocument("working", "Diff", "repo", raw)
  assert.equal(parsed.capturedPatchBytes, Buffer.byteLength(raw))
  assert.equal(parsed.capturedPatchLines, 6)
})

test("omission files retain path, reason, measured value, and relevant limit", () => {
  const file = omittedDiffFile({
    path: "large/file.txt",
    status: "modified",
    staged: true,
    reason: "file-too-large",
    measuredBytes: 10 * 1024 * 1024,
    limitBytes: 2 * 1024 * 1024,
  })

  assert.equal(file.omission?.reason, "file-too-large")
  assert.equal(file.omission?.measuredBytes, 10 * 1024 * 1024)
  assert.equal(file.omission?.limitBytes, 2 * 1024 * 1024)
  assert.equal(file.omission?.message.includes("10 MiB"), true)
  assert.deepEqual(formatDiffDisplay(file), [
    { type: "summary", text: 'Diff omitted for "large/file.txt"' },
    { type: "summary", text: file.omission?.message },
  ])
})

test("omission-only files remain distinct selectable tree entries", () => {
  const files = [
    omittedDiffFile({
      path: "same/path.txt",
      status: "modified",
      staged: false,
      reason: "capture-overflow",
      limitBytes: 100,
    }),
    omittedDiffFile({
      path: "other/path.txt",
      status: "added",
      staged: false,
      untracked: true,
      reason: "file-count-budget",
      limitFiles: 1,
    }),
  ]

  const rows = buildTreeRows(files).filter((row) => row.fileIndex !== undefined)

  assert.equal(rows.length, 2)
  assert.equal(
    rows.every((row) => row.label.includes("(omitted)")),
    true,
  )
  assert.deepEqual(rows.map((row) => row.fileIndex).sort(), [0, 1])
})
