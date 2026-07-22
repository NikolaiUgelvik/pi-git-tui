import assert from "node:assert/strict"
import { test } from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { measureWrappedColumns, prepareColumnWrap } from "../src/ansi-column-wrap.js"
import {
  normalizeDiffText,
  prepareStyledColumns,
  type StyledColumns,
  slicePreparedColumns,
  sliceStyledColumns,
} from "../src/ansi-segments.js"

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu")
const plain = (value: string): string => value.replace(ANSI_PATTERN, "")

test("column slices clamp and optionally pad ASCII", () => {
  assert.equal(sliceStyledColumns("abcdef", 2, 3), "cde")
  assert.equal(sliceStyledColumns("abcdef", -4, 2), "ab")
  assert.equal(sliceStyledColumns("abcdef", 20, 3), "")
  assert.equal(sliceStyledColumns("abcdef", 20, 3, { pad: true }), "   ")
  assert.equal(sliceStyledColumns("abcdef", 0, 0), "")
})

test("prepared columns wrap at whitespace and hard-wrap overlong words", () => {
  const prepared = prepareStyledColumns("alpha beta gamma")
  assert.ok(prepared)
  const slices = prepareColumnWrap(prepared, 8).segments(0, Number.MAX_SAFE_INTEGER)

  assert.deepEqual(slices, [
    { start: 0, length: 6 },
    { start: 6, length: 5 },
    { start: 11, length: 5 },
  ])
  assert.deepEqual(
    slices.map((slice) => plain(slicePreparedColumns(prepared, slice.start, slice.length))),
    ["alpha ", "beta ", "gamma"],
  )

  const long = prepareStyledColumns("abcdefghij kl")
  assert.ok(long)
  assert.deepEqual(
    prepareColumnWrap(long, 4)
      .segments(0, Number.MAX_SAFE_INTEGER)
      .map((slice) => plain(slicePreparedColumns(long, slice.start, slice.length))),
    ["abcd", "efgh", "ij ", "kl"],
  )

  const empty = prepareStyledColumns("")
  assert.ok(empty)
  assert.deepEqual(prepareColumnWrap(empty, 8).segments(0, 1), [{ start: 0, length: 0 }])
})

test("wrapped column plans stay lazy for maximum-sized overlong tokens", () => {
  const text = "x ".repeat(1024 * 1024)
  const prepared: StyledColumns = Object.freeze({ plainText: text, width: text.length, weightBytes: text.length })
  const plan = prepareColumnWrap(prepared, 1)

  assert.equal(plan.segmentCount, text.length)
  assert.deepEqual(plan.segments(text.length - 1, 2), [{ start: text.length - 1, length: 1 }])
  assert.deepEqual(measureWrappedColumns(prepared, 80, 40), { segmentCount: 40, truncated: true })
})

test("prepared word wrapping respects wide grapheme column boundaries", () => {
  const prepared = prepareStyledColumns("界界 alpha")
  assert.ok(prepared)
  const slices = prepareColumnWrap(prepared, 5).segments(0, Number.MAX_SAFE_INTEGER)

  assert.deepEqual(
    slices.map((slice) => plain(slicePreparedColumns(prepared, slice.start, slice.length))),
    ["界界 ", "alpha"],
  )
})

test("column slices replay and close ANSI styles across boundaries", () => {
  const line = "\x1b[31mab\x1b[44mcd\x1b[0mef"
  const sliced = sliceStyledColumns(line, 1, 4)

  assert.equal(plain(sliced), "bcde")
  assert.equal(sliced.startsWith("\x1b[31m"), true)
  assert.equal(sliced.includes("\x1b[31;44m"), true)
  assert.equal(sliced.includes("\x1b[0m"), true)
  assert.equal(visibleWidth(sliced), 4)
})

test("wide graphemes become blank fragments instead of being split", () => {
  assert.equal(sliceStyledColumns("A界B", 0, 2), "A ")
  assert.equal(sliceStyledColumns("A界B", 2, 2), " B")
  assert.equal(visibleWidth(sliceStyledColumns("A界B", 1, 2)), 2)
})

test("combining, flag, skin-tone, and ZWJ graphemes remain atomic", () => {
  const graphemes = ["e\u0301", "🇺🇦", "👍🏽", "👨‍👩‍👧‍👦"]
  for (const grapheme of graphemes) {
    const width = visibleWidth(grapheme)
    assert.equal(sliceStyledColumns(`${grapheme}X`, 0, width), grapheme)
    if (width > 1) {
      assert.equal(sliceStyledColumns(`${grapheme}X`, 1, 1), " ")
    }
  }
})

test("tabs are normalized consistently before viewport slicing", () => {
  assert.equal(sliceStyledColumns("A\tB", 0, 6), "A    B")
  assert.equal(sliceStyledColumns("A\tB", 2, 3), "   ")
  assert.equal(visibleWidth(sliceStyledColumns("A\tB", 1, 4, { pad: true })), 4)
})

test("prepared columns track combined SGR, selective resets, and extended colors", () => {
  const styled = "\x1b[1;2;3;4;7;9;38;5;120;48;2;1;2;3mA\x1b[22;23;24;27;29;39;49mB\x1b[38;2;9;8;7;48;5;42mC"
  const prepared = prepareStyledColumns(styled, { expectedPlainText: "ABC" })
  assert.ok(prepared)

  const first = slicePreparedColumns(prepared, 0, 1)
  const second = slicePreparedColumns(prepared, 1, 1)
  const third = slicePreparedColumns(prepared, 2, 1)
  assert.equal(first, "\x1b[1;2;3;4;7;9;38;5;120;48;2;1;2;3mA\x1b[0m")
  assert.equal(second, "B")
  assert.equal(third, "\x1b[38;2;9;8;7;48;5;42mC\x1b[0m")
})

test("decorations override syntax foreground while preserving background and close before padding", () => {
  const prepared = prepareStyledColumns("\x1b[34mabcdef\x1b[39m", {
    expectedPlainText: "abcdef",
    backgroundAnsi: "\x1b[42m",
    decorations: [{ start: 2, end: 4, foregroundAnsi: "\x1b[31m", bold: true }],
    paddingForegroundAnsi: "\x1b[37m",
    paddingBackgroundAnsi: "\x1b[42m",
  })
  assert.ok(prepared)

  const sliced = slicePreparedColumns(prepared, 3, 3, { pad: true, padTo: 5 })
  assert.equal(plain(sliced), "def  ")
  assert.equal(sliced.startsWith("\x1b[1;31;42md\x1b[0m"), true)
  assert.equal(sliced.endsWith("\x1b[37;42m  \x1b[0m"), true)
  assert.equal(visibleWidth(sliced), 5)
})

test("trusted preparation rejects altered text and non-SGR terminal escapes", () => {
  assert.equal(prepareStyledColumns("\x1b]8;;url\x07text"), undefined)
  assert.equal(prepareStyledColumns("\x1b[31mtext", { expectedPlainText: "other" }), undefined)
  assert.equal(prepareStyledColumns("\u009b31mtext"), undefined)
})

test("diff normalization escapes terminal controls after fixed-width tabs", () => {
  assert.equal(normalizeDiffText("A\tB\x00\x1b\x7f\u0080界"), "A    B\\x00\\x1b\\x7f\\x80界")
})
