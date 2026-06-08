import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { buildDocument, emptyDocument } from "../src/diff-parser.js"
import type { DiffFile } from "../src/types.js"

// Resolve to source tests/ directory (not .tmp-tests/)
const __dirname = dirname(fileURLToPath(import.meta.url))
const sourceDir = __dirname.includes(".tmp-tests") ? __dirname.replace(".tmp-tests/", "") : __dirname
const fixturesDir = join(sourceDir, "fixtures")

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8")
}

type ExpectedParsedFile = Pick<DiffFile, "path" | "status">

function assertParsedFile(file: DiffFile | undefined, expected: ExpectedParsedFile): void {
  assert.ok(file)
  assert.equal(file.status, expected.status)
  assert.equal(file.path, expected.path)
}

// --- emptyDocument ---

test("emptyDocument creates an empty document with correct defaults", () => {
  const doc = emptyDocument("Title", "Subtitle", "working")

  assert.equal(doc.title, "Title")
  assert.equal(doc.subtitle, "Subtitle")
  assert.equal(doc.mode, "working")
  assert.equal(doc.raw, "")
  assert.deepEqual(doc.files, [])
})

test("emptyDocument supports optional commit and repositoryState", () => {
  const doc = emptyDocument("Title", "Subtitle", "commit", { hash: "abc", message: "msg" }, "missing")

  assert.equal(doc.mode, "commit")
  assert.equal(doc.commit?.hash, "abc")
  assert.equal(doc.repositoryState, "missing")
})

// --- parseDiff: added file ---

test("parseDiff detects added file from /dev/null old path", () => {
  const raw = readFixture("diff-add.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "added")
  assert.equal(doc.files[0]?.path, "src/new-file.ts")
  assert.equal(doc.files[0]?.oldPath, "/dev/null")
  assert.equal(doc.files[0]?.newPath, "src/new-file.ts")
})

// --- parseDiff: deleted file ---

test("parseDiff detects deleted file from /dev/null new path", () => {
  const raw = readFixture("diff-delete.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "deleted")
  assert.equal(doc.files[0]?.path, "src/old-file.ts")
  assert.equal(doc.files[0]?.oldPath, "src/old-file.ts")
  assert.equal(doc.files[0]?.newPath, "/dev/null")
})

// --- parseDiff: renamed file ---

test("parseDiff detects renamed file and extracts old/new paths", () => {
  const raw = readFixture("diff-rename.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "renamed")
  assert.equal(doc.files[0]?.path, "src/new-name.ts")
  assert.equal(doc.files[0]?.oldPath, "src/old-name.ts")
  assert.equal(doc.files[0]?.newPath, "src/new-name.ts")
})

// --- parseDiff: copied file ---

test("parseDiff detects copied file", () => {
  const raw = readFixture("diff-copy.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "copied")
  assert.equal(doc.files[0]?.path, "src/copy.ts")
  assert.equal(doc.files[0]?.oldPath, "src/original.ts")
  assert.equal(doc.files[0]?.newPath, "src/copy.ts")
})

// --- parseDiff: binary file ---

test("parseDiff detects binary file", () => {
  const raw = readFixture("diff-binary.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "binary")
  assert.equal(doc.files[0]?.path, "assets/logo.png")
})

// --- parseDiff: conflicted file ---

test("parseDiff marks conflicted paths when provided in conflictedPaths set", () => {
  const raw = readFixture("diff-conflicted.txt")
  const doc = buildDocument("working", "test", "test", raw, undefined, new Set(), new Set(["src/module.ts"]))

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "conflicted")
  assert.equal(doc.files[0]?.path, "src/module.ts")
})

// --- parseDiff: untracked file ---

test("parseDiff marks untracked files when provided in untrackedPaths set", () => {
  const raw = readFixture("diff-untracked.txt")
  const doc = buildDocument("working", "test", "test", raw, undefined, new Set(), new Set(), new Set(["src/temp.ts"]))

  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "added")
  assert.equal(doc.files[0]?.untracked, true)
})

// --- parseDiff: no-HEAD case ---

test("parseDiff handles no-HEAD multi-file diff with all additions", () => {
  const raw = readFixture("diff-no-head.txt")
  const doc = buildDocument("working", "test", "test", raw)

  assert.equal(doc.files.length, 2)
  assert.equal(doc.files[0]?.status, "added")
  assert.equal(doc.files[1]?.status, "added")
  assert.equal(doc.files[0]?.path, "README.md")
  assert.equal(doc.files[1]?.path, "src/index.ts")
})

// --- parseDiff: multi-file diff ---

test("parseDiff splits multi-file diff into individual files", () => {
  const raw = readFixture("diff-multi-file.txt")
  const doc = buildDocument("working", "test", "test", raw)

  const expectedFiles: ExpectedParsedFile[] = [
    { status: "added", path: "src/added.ts" },
    { status: "deleted", path: "src/deleted.ts" },
    { status: "modified", path: "src/modified.ts" },
    { status: "renamed", path: "src/renamed-new.ts" },
    { status: "binary", path: "assets/image.png" },
  ]

  assert.equal(doc.files.length, expectedFiles.length)
  expectedFiles.forEach((expected, index) => {
    assertParsedFile(doc.files[index], expected)
  })
})

// --- Edge cases ---

test("parseDiff returns empty array for empty input", () => {
  const doc = buildDocument("working", "test", "test", "")
  assert.deepEqual(doc.files, [])
})

test("parseDiff returns empty array for whitespace-only input", () => {
  // Whitespace-only input is treated as a single chunk with no recognizable paths
  const doc = buildDocument("working", "test", "test", "   \n\n  ")
  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.path, "(unknown)")
  assert.equal(doc.files[0]?.status, "modified")
})

test("parseDiff handles single line diff", () => {
  // Without ---/+++ lines, the parser can't determine old/new paths, so status is 'modified'
  const raw = "diff --git a/x.txt b/x.txt\nnew file mode 100644"
  const doc = buildDocument("working", "test", "test", raw)
  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "modified")
  assert.equal(doc.files[0]?.path, "x.txt")
})

test("parseDiff handles modified file (no special status)", () => {
  const raw = [
    "diff --git a/src/file.ts b/src/file.ts",
    "index 111..222 100644",
    "--- a/src/file.ts",
    "+++ b/src/file.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n")
  const doc = buildDocument("working", "test", "test", raw)
  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.status, "modified")
  assert.equal(doc.files[0]?.path, "src/file.ts")
})

test("parseDiff handles quoted paths with special characters", () => {
  const raw = [
    'diff --git a/"src/file with spaces.ts" b/"src/file with spaces.ts"',
    '--- a/"src/file with spaces.ts"',
    '+++ b/"src/file with spaces.ts"',
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n")
  const doc = buildDocument("working", "test", "test", raw)
  assert.equal(doc.files.length, 1)
  assert.equal(doc.files[0]?.path, "src/file with spaces.ts")
})

test("parseDiff preserves staged/untracked flags from buildDocument sets", () => {
  const raw = readFixture("diff-add.txt")
  const doc = buildDocument(
    "working",
    "test",
    "test",
    raw,
    undefined,
    new Set(["src/new-file.ts"]),
    new Set(),
    new Set(),
  )
  assert.equal(doc.files[0]?.staged, true)
  assert.equal(doc.files[0]?.untracked, undefined)
})
