import assert from "node:assert/strict"
import { test } from "node:test"
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui"
import { SingleLineTextField } from "../src/single-line-text-field.js"

const graphemes = ["e\u0301", "🇺🇦", "👍🏽", "👨‍👩‍👧‍👦"]

for (const grapheme of graphemes) {
  test(`Backspace removes the complete ${JSON.stringify(grapheme)} grapheme`, () => {
    const field = new SingleLineTextField(`A${grapheme}`)

    assert.equal(field.handleInput("\x7f", "editor"), true)

    assert.equal(field.value, "A")
  })

  test(`Delete removes the complete ${JSON.stringify(grapheme)} grapheme`, () => {
    const field = new SingleLineTextField(`${grapheme}B`)
    field.setValue(field.value, "start")

    assert.equal(field.handleInput("\x1b[3~", "editor"), true)

    assert.equal(field.value, "B")
  })
}

test("Left and Right keep insertion points on grapheme boundaries", () => {
  const family = "👨‍👩‍👧‍👦"
  const field = new SingleLineTextField(`A${family}B`)

  field.handleInput("\x1b[D", "editor")
  field.handleInput("\x1b[D", "editor")
  field.handleInput("\x1b[C", "editor")
  field.handleInput("X", "editor")

  assert.equal(field.value, `A${family}XB`)
})

test("narrow rendering keeps CJK and emoji carets visible and bounded", () => {
  const field = new SingleLineTextField("prefix界界界👨‍👩‍👧‍👦suffix")

  for (const width of [4, 7, 10]) {
    const rendered = field.render(width, true)
    assert.ok(rendered.includes(CURSOR_MARKER))
    assert.equal(visibleWidth(rendered), width)
  }
})

test("only focused rendering emits the hardware cursor marker", () => {
  const field = new SingleLineTextField("message")

  assert.equal(field.render(12, false).includes(CURSOR_MARKER), false)
  assert.equal(field.render(12, true).includes(CURSOR_MARKER), true)
  field.invalidate()
})

test("plain and Kitty printable punctuation belongs to the field", () => {
  const field = new SingleLineTextField()

  for (const input of ["?", "*", "q", "\x1b[63u", "\x1b[42u", "\x1b[113u"]) {
    assert.equal(field.handleInput(input, "editor"), true)
  }

  assert.equal(field.value, "?*q?*q")
})

test("reserved search and editor shortcuts are not consumed", () => {
  const field = new SingleLineTextField()

  assert.equal(field.handleInput("\r", "search"), false)
  assert.equal(field.handleInput("\x1b[A", "search"), false)
  assert.equal(field.handleInput("\x1b", "search"), false)
  assert.equal(field.handleInput("\x07", "editor"), false)
  assert.equal(field.handleInput("\x18", "editor"), false)
  assert.equal(field.value, "")
})
