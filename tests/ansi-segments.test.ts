import assert from "node:assert/strict"
import { test } from "node:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import { sliceStyledColumns } from "../src/ansi-segments.js"

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu")
const plain = (value: string): string => value.replace(ANSI_PATTERN, "")

test("column slices clamp and optionally pad ASCII", () => {
  assert.equal(sliceStyledColumns("abcdef", 2, 3), "cde")
  assert.equal(sliceStyledColumns("abcdef", -4, 2), "ab")
  assert.equal(sliceStyledColumns("abcdef", 20, 3), "")
  assert.equal(sliceStyledColumns("abcdef", 20, 3, { pad: true }), "   ")
  assert.equal(sliceStyledColumns("abcdef", 0, 0), "")
})

test("column slices replay and close ANSI styles across boundaries", () => {
  const line = "\x1b[31mab\x1b[44mcd\x1b[0mef"
  const sliced = sliceStyledColumns(line, 1, 4)

  assert.equal(plain(sliced), "bcde")
  assert.equal(sliced.startsWith("\x1b[31m"), true)
  assert.equal(sliced.includes("\x1b[44m"), true)
  assert.equal(sliced.endsWith("\x1b[0m"), true)
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
