import assert from "node:assert/strict"
import { test } from "node:test"
import { formatDiffDisplay } from "../src/diff-display.js"
import type { DiffFile } from "../src/types.js"

function file(lines: string[], options: Partial<DiffFile> = {}): DiffFile {
  return {
    path: "src/example.ts",
    status: "modified",
    staged: false,
    lines,
    ...options,
  }
}

test("formatDiffDisplay formats normal hunks and hides metadata", () => {
  const rows = formatDiffDisplay(
    file([
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -41,3 +41,4 @@ function greet()",
      " const before = true",
      "-const value = oldValue",
      "+const value = newValue",
      "+const extra = true",
      " return value",
    ]),
  )

  assert.deepEqual(rows, [
    { type: "hunk", sectionText: "function greet()", oldStart: 41, oldCount: 3, newStart: 41, newCount: 4 },
    { type: "context", marker: " ", lineNumber: 41, text: "const before = true" },
    { type: "deletion", marker: "-", lineNumber: 42, text: "const value = oldValue" },
    { type: "addition", marker: "+", lineNumber: 42, text: "const value = newValue" },
    { type: "addition", marker: "+", lineNumber: 43, text: "const extra = true" },
    { type: "context", marker: " ", lineNumber: 44, text: "return value" },
  ])
  assert.equal(
    rows.some((row) => "text" in row && row.text.startsWith("diff --git")),
    false,
  )
})

test("formatDiffDisplay supports optional hunk counts", () => {
  assert.deepEqual(formatDiffDisplay(file(["@@ -1 +1 @@", "-old", "+new"])), [
    { type: "hunk", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
    { type: "deletion", marker: "-", lineNumber: 1, text: "old" },
    { type: "addition", marker: "+", lineNumber: 1, text: "new" },
  ])
})

test("formatDiffDisplay numbers added and deleted file hunks", () => {
  assert.deepEqual(formatDiffDisplay(file(["@@ -0,0 +1,2 @@", "+one", "+two"])), [
    { type: "hunk", oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 },
    { type: "addition", marker: "+", lineNumber: 1, text: "one" },
    { type: "addition", marker: "+", lineNumber: 2, text: "two" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["@@ -1,2 +0,0 @@", "-one", "-two"])), [
    { type: "hunk", oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 },
    { type: "deletion", marker: "-", lineNumber: 1, text: "one" },
    { type: "deletion", marker: "-", lineNumber: 2, text: "two" },
  ])
})

test("formatDiffDisplay resets counters for multiple hunks", () => {
  assert.deepEqual(formatDiffDisplay(file(["@@ -1,1 +1,1 @@", " one", "@@ -10,1 +20,1 @@", "-old", "+new"])), [
    { type: "hunk", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
    { type: "context", marker: " ", lineNumber: 1, text: "one" },
    { type: "hunk", oldStart: 10, oldCount: 1, newStart: 20, newCount: 1 },
    { type: "deletion", marker: "-", lineNumber: 10, text: "old" },
    { type: "addition", marker: "+", lineNumber: 20, text: "new" },
  ])
})

test("formatDiffDisplay summarizes metadata-only changes", () => {
  assert.deepEqual(formatDiffDisplay(file(["Binary files a/image.png and b/image.png differ"])), [
    { type: "summary", text: "Binary files a/image.png and b/image.png differ" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["GIT binary patch", "literal 3", "abc", "delta 4", "def"])), [
    { type: "summary", text: "Binary patch" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["similarity index 91%", "rename from old.ts", "rename to new.ts"])), [
    { type: "summary", text: "Renamed old.ts -> new.ts (91%)" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["similarity index 88%", "copy from old.ts", "copy to copy.ts"])), [
    { type: "summary", text: "Copied old.ts -> copy.ts (88%)" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["old mode 100644", "new mode 100755"])), [
    { type: "summary", text: "Mode changed 100644 -> 100755" },
  ])
  assert.deepEqual(formatDiffDisplay(file(["new file mode 100644"])), [{ type: "summary", text: "New file" }])
  assert.deepEqual(formatDiffDisplay(file(["deleted file mode 100644"])), [{ type: "summary", text: "Deleted file" }])
})

test("formatDiffDisplay recovers from malformed hunks", () => {
  assert.deepEqual(formatDiffDisplay(file(["@@ not a hunk", "raw outside", "@@ -3 +4 @@", "-old", "+new"])), [
    { type: "unknown", text: "@@ not a hunk" },
    { type: "unknown", text: "raw outside" },
    { type: "hunk", oldStart: 3, oldCount: 1, newStart: 4, newCount: 1 },
    { type: "deletion", marker: "-", lineNumber: 3, text: "old" },
    { type: "addition", marker: "+", lineNumber: 4, text: "new" },
  ])
})

test("formatDiffDisplay preserves conflict marker text", () => {
  const rows = formatDiffDisplay(
    file(["@@ -1,4 +1,4 @@", "+<<<<<<< ours", "+||||||| base", "+======", "+>>>>>>> theirs"]),
  )

  assert.deepEqual(
    rows.filter((row) => row.type === "addition").map((row) => row.text),
    ["<<<<<<< ours", "||||||| base", "======", ">>>>>>> theirs"],
  )
})
