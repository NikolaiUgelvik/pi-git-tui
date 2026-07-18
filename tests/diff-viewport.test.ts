import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"
import { renderDiffViewport } from "../src/diff-viewport.js"
import type { DiffFile } from "../src/types.js"
import { testTheme } from "./helpers/viewer.js"

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu")
const plain = (value: string): string => value.replace(ANSI_PATTERN, "")

function file(lines: string[], path = "x"): DiffFile {
  return { path, status: "modified", stageState: "unstaged", lines }
}

function viewport(
  diffFile: DiffFile,
  options: Partial<{
    width: number
    height: number
    verticalOffset: number
    horizontalOffset: number
    theme: Theme
  }> = {},
) {
  return renderDiffViewport({
    file: diffFile,
    width: options.width ?? 18,
    height: options.height ?? 2,
    verticalOffset: options.verticalOffset ?? 0,
    horizontalOffset: options.horizontalOffset ?? 0,
    theme: options.theme ?? testTheme,
  })
}

test("horizontal offsets preserve a fixed line-number gutter", () => {
  const diffFile = file(["@@ -1 +1 @@", "+abcdefghijklmnopqrstuvwxyz"])
  const first = viewport(diffFile, { horizontalOffset: 0 })
  const middle = viewport(diffFile, { horizontalOffset: 4 })
  const last = viewport(diffFile, { horizontalOffset: Number.MAX_SAFE_INTEGER })

  for (const result of [first, middle, last]) {
    assert.equal(plain(result.lines[1] ?? "").slice(0, 5), "+1 │ ")
    assert.equal(visibleWidth(result.lines[1] ?? ""), 18)
  }
  assert.equal(middle.horizontalOffset, 4)
  assert.equal(last.horizontalOffset, last.maxHorizontalOffset)
  assert.notEqual(first.lines[1], middle.lines[1])
})

test("hunks and summaries reserve the same blank gutter region", () => {
  const result = viewport(file(["@@ -1 +1 @@ section", "+changed"]), { width: 30 })

  assert.equal(plain(result.lines[0] ?? "").slice(0, result.gutterWidth), " ".repeat(result.gutterWidth))
  assert.match(plain(result.lines[0] ?? ""), /@@ x · lines 1 @@ section/u)
  assert.equal(plain(result.lines[1] ?? "").slice(0, result.gutterWidth), "+1 │ ")
})

test("ANSI, tabs, wide Unicode, and whitespace remain column-safe", () => {
  const diffFile = file(["@@ -1 +1 @@", "+A\tB\x1b[31m界e\u0301🇺🇦👨‍👩‍👧‍👦\x1b[0m  tail  "])
  const result = viewport(diffFile, { width: 16, height: 2, horizontalOffset: 5 })
  const codeLine = result.lines[1] ?? ""

  assert.equal(visibleWidth(codeLine), 16)
  assert.equal(codeLine.includes("\x1b[31m"), true)
  assert.equal(codeLine.includes("\x1b[0m"), true)
  assert.equal(plain(codeLine).slice(0, 6), "+1 │ B")
  assert.doesNotMatch(codeLine, /�/u)
})

test("vertical and horizontal offsets remain independent", () => {
  const diffFile = file(["@@ -1,2 +1,3 @@", " first long context", "+second long addition", "+third long addition"])
  const horizontal = viewport(diffFile, { width: 15, height: 2, horizontalOffset: 4, verticalOffset: 0 })
  const vertical = viewport(diffFile, { width: 15, height: 2, horizontalOffset: 4, verticalOffset: 2 })

  assert.equal(horizontal.horizontalOffset, 4)
  assert.equal(vertical.horizontalOffset, 4)
  assert.equal(horizontal.verticalOffset, 0)
  assert.equal(vertical.verticalOffset, 2)
})

test("offsets clamp after widening and the scrollbar column is reserved", () => {
  const diffFile = file(["@@ -1,2 +1,2 @@", "+abcdefghijklmnopqrstuvwxyz", "+second"])
  const narrow = viewport(diffFile, { width: 12, height: 1, horizontalOffset: 999 })
  const wide = viewport(diffFile, { width: 80, height: 4, horizontalOffset: narrow.horizontalOffset })

  assert.ok(narrow.maxHorizontalOffset > 0)
  assert.equal(visibleWidth(narrow.lines[0] ?? ""), 12)
  assert.match(plain(narrow.lines[0] ?? ""), /[│┃]$/u)
  assert.equal(wide.horizontalOffset, 0)
  assert.equal(wide.maxHorizontalOffset, 0)
})
