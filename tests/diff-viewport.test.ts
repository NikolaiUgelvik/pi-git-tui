import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { visibleWidth } from "@earendil-works/pi-tui"
import { prepareDiffPresentation } from "../src/diff-presentation.js"
import type { SyntaxHighlighting } from "../src/diff-syntax.js"
import { renderDiffViewport } from "../src/diff-viewport.js"
import type { DiffFile } from "../src/types.js"
import {
  diffHighlightTheme as ansiTheme,
  stripTestAnsi as plain,
  testSgrPattern as sgr,
} from "./helpers/diff-highlighting.js"

const syntax: SyntaxHighlighting = {
  languageFromPath: () => "test",
  highlight: (code) => code.split("\n").map((line) => line.replace(/\b(const|long)\b/gu, "\x1b[34m$1\x1b[39m")),
}

function file(lines: string[], path = "x.ts"): DiffFile {
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
  const theme = options.theme ?? ansiTheme
  return renderDiffViewport({
    display: prepareDiffPresentation(diffFile, theme, syntax),
    width: options.width ?? 18,
    height: options.height ?? 2,
    verticalOffset: options.verticalOffset ?? 0,
    horizontalOffset: options.horizontalOffset ?? 0,
    theme,
  })
}

test("horizontal offsets preserve a fixed styled line-number gutter", () => {
  const diffFile = file(["@@ -1 +1 @@", "+const abcdefghijklmnopqrstuvwxyz = true"])
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
  assert.match(middle.lines[1] ?? "", sgr("[^m]*34[^m]*m"))
})

test("hunks and summaries reserve the same blank gutter region", () => {
  const result = viewport(file(["@@ -1 +1 @@ section", "+changed"]), { width: 40 })

  assert.equal(plain(result.lines[0] ?? "").slice(0, result.gutterWidth), " ".repeat(result.gutterWidth))
  assert.match(plain(result.lines[0] ?? ""), /@@ x.ts · lines 1 @@ section/u)
  assert.equal(plain(result.lines[1] ?? "").slice(0, result.gutterWidth), "+1 │ ")
})

test("tabs, raw controls, wide Unicode, and whitespace remain column-safe", () => {
  const diffFile = file(["@@ -1 +1 @@", "+A\tB\x1b界e\u0301🇺🇦👨‍👩‍👧‍👦  tail  "])
  const result = viewport(diffFile, { width: 20, height: 2, horizontalOffset: 5 })
  const codeLine = result.lines[1] ?? ""

  assert.equal(visibleWidth(codeLine), 20)
  assert.equal(plain(codeLine).slice(0, 6), "+1 │ B")
  assert.match(plain(codeLine), /\\x1b/u)
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

test("offsets clamp after responsive widening and reserve the scrollbar column", () => {
  const diffFile = file(["@@ -1,2 +1,2 @@", "+abcdefghijklmnopqrstuvwxyz", "+second"])
  const narrow = viewport(diffFile, { width: 12, height: 1, horizontalOffset: 999 })
  const wide = viewport(diffFile, { width: 80, height: 4, horizontalOffset: narrow.horizontalOffset })

  assert.ok(narrow.maxHorizontalOffset > 0)
  assert.equal(visibleWidth(narrow.lines[0] ?? ""), 12)
  assert.match(plain(narrow.lines[0] ?? ""), /[│┃]$/u)
  assert.equal(wide.horizontalOffset, 0)
  assert.equal(wide.maxHorizontalOffset, 0)
})

test("zero-width viewports never emit a scrollbar column", () => {
  const result = viewport(file(["@@ -1 +1 @@", "+changed"]), { width: 0, height: 1 })
  assert.deepEqual(result.lines, [""])
})

test("wide grapheme edge fragments are styled spaces and conflict rows remain bold", () => {
  const wide = viewport(file(["@@ -1 +1 @@", "+A界B"]), { width: 6, height: 2, horizontalOffset: 1 })
  assert.equal(plain(wide.lines[1] ?? "").startsWith("+1 │  "), true)
  assert.equal(visibleWidth(wide.lines[1] ?? ""), 6)

  const conflict = viewport(file(["@@ -1 +1 @@", "+<<<<<<< ours"]), { width: 24, height: 2 })
  assert.match(conflict.lines[1] ?? "", sgr("[^m]*1[^m]*m"))
  assert.match(conflict.lines[1] ?? "", sgr("[^m]*42m"))
})
