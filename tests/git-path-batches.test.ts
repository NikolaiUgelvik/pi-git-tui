import assert from "node:assert/strict"
import { test } from "node:test"
import { chunkLiteralPathGroups, chunkLiteralPaths, literalPathsFit } from "../src/git-path-batches.js"

const generousBytes = 1024

test("connected copy and source groups stay in one argument batch", () => {
  const copy = { name: "copy", paths: ["source.txt", "copy.txt"] }
  const source = { name: "source", paths: ["source.txt"] }
  const independent = { name: "independent", paths: ["other.txt"] }

  const chunks = chunkLiteralPathGroups(
    [copy, source, independent].map((value) => ({ value, paths: value.paths })),
    { argvChunkBytes: generousBytes, argvChunkPaths: 2 },
  )

  assert.deepEqual(
    chunks.batches.map((batch) => batch.map((group) => group.name)),
    [["copy", "source"], ["independent"]],
  )
  assert.deepEqual(chunks.oversized, [])
})

test("an oversized connected component omits every represented group", () => {
  const copy = { name: "copy", paths: ["source.txt", "copy.txt"] }
  const source = { name: "source", paths: ["source.txt"] }

  const chunks = chunkLiteralPathGroups(
    [copy, source].map((value) => ({ value, paths: value.paths })),
    { argvChunkBytes: generousBytes, argvChunkPaths: 1 },
  )

  assert.deepEqual(chunks.batches, [])
  assert.deepEqual(
    chunks.oversized.map((group) => group.name),
    ["copy", "source"],
  )
})

test("argument accounting is conservative for UTF-16 and Windows quoting", () => {
  const ascii = "a".repeat(100)
  assert.equal(literalPathsFit([ascii], { argvChunkBytes: 201, argvChunkPaths: 1 }), false)
  assert.equal(literalPathsFit([ascii], { argvChunkBytes: 202, argvChunkPaths: 1 }), true)

  const quoted = `space ${"\\".repeat(20)}`
  const naiveUtf16Bytes = (quoted.length + 1) * 2
  assert.equal(literalPathsFit([quoted], { argvChunkBytes: naiveUtf16Bytes, argvChunkPaths: 1 }), false)
})

test("single literal paths that exceed the command budget never reach a batch", () => {
  assert.throws(
    () => chunkLiteralPaths(["long path"], { argvChunkBytes: 8, argvChunkPaths: 1 }),
    /exceeds the configured argument limit/u,
  )
})
