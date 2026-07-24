import assert from "node:assert/strict"
import { test } from "node:test"
import { buildDiffArgs, CANONICAL_PATCH_OPTIONS } from "../src/git-diff-args.js"

const prefix = ["-c", "core.quotepath=false"]

test("builds canonical staged and revision-pair diffs", () => {
  assert.deepEqual(buildDiffArgs({ options: [...CANONICAL_PATCH_OPTIONS, "--cached"] }), [
    ...prefix,
    "diff",
    ...CANONICAL_PATCH_OPTIONS,
    "--cached",
    "--",
  ])
  assert.deepEqual(buildDiffArgs({ options: CANONICAL_PATCH_OPTIONS, revisions: ["from", "to"] }), [
    ...prefix,
    "diff",
    ...CANONICAL_PATCH_OPTIONS,
    "from",
    "to",
    "--",
  ])
})

test("literal and empty paths both enable literal pathspec mode", () => {
  assert.deepEqual(buildDiffArgs({ paths: ["a[b].ts"] }), [...prefix, "--literal-pathspecs", "diff", "--", "a[b].ts"])
  assert.deepEqual(buildDiffArgs({ paths: [] }), [...prefix, "--literal-pathspecs", "diff", "--"])
})

test("root diff-tree has fixed flags before raw, stat, and output options", () => {
  assert.deepEqual(
    buildDiffArgs({
      command: "root-diff-tree",
      options: ["--raw", "--stat", "--output=/tmp/diff"],
      revisions: ["abc"],
    }),
    [...prefix, "diff-tree", "--root", "--no-commit-id", "-r", "--raw", "--stat", "--output=/tmp/diff", "abc", "--"],
  )
})
