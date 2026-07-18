import assert from "node:assert/strict"
import { test } from "node:test"
import {
  FilterableListState,
  isEnter,
  isPrintableInput,
  matchesSearch,
  nextListScroll,
  nextListSelectionIndex,
  searchTokens,
} from "../src/filterable-list-state.js"

// --- searchTokens ---

test("searchTokens splits on whitespace and lowercases", () => {
  assert.deepEqual(searchTokens("Hello  World"), ["hello", "world"])
  assert.deepEqual(searchTokens("  foo bar  "), ["foo", "bar"])
})

test("searchTokens returns empty array for empty or whitespace-only query", () => {
  assert.deepEqual(searchTokens(""), [])
  assert.deepEqual(searchTokens("   "), [])
})

// --- matchesSearch ---

test("matchesSearch checks that all tokens appear in haystack", () => {
  assert.equal(matchesSearch("Hello World", ["hello"]), true)
  assert.equal(matchesSearch("Hello World", ["hello", "world"]), true)
  assert.equal(matchesSearch("Hello World", ["hello", "foo"]), false)
})

test("matchesSearch returns true for empty token list", () => {
  assert.equal(matchesSearch("anything", []), true)
})

test("matchesSearch is case-insensitive", () => {
  assert.equal(matchesSearch("Hello", ["hello"]), true)
  assert.equal(matchesSearch("HELLO", ["hello"]), true)
})

// --- nextListSelectionIndex ---

test("nextListSelectionIndex moves up", () => {
  const upKey = "\x1b[A"
  assert.equal(nextListSelectionIndex(upKey, 5, 10), 4)
  assert.equal(nextListSelectionIndex(upKey, 0, 10), 0)
  assert.equal(nextListSelectionIndex(upKey, 0, 1), 0)
})

test("nextListSelectionIndex moves down", () => {
  const downKey = "\x1b[B"
  assert.equal(nextListSelectionIndex(downKey, 0, 10), 1)
  assert.equal(nextListSelectionIndex(downKey, 9, 10), 9)
  assert.equal(nextListSelectionIndex(downKey, 0, 1), 0)
})

test("nextListSelectionIndex handles page up", () => {
  const pageUpKey = "\x1b[5~"
  assert.equal(nextListSelectionIndex(pageUpKey, 20, 30), 10)
  assert.equal(nextListSelectionIndex(pageUpKey, 5, 30), 0)
})

test("nextListSelectionIndex handles page down", () => {
  const pageDownKey = "\x1b[6~"
  assert.equal(nextListSelectionIndex(pageDownKey, 0, 30), 10)
  assert.equal(nextListSelectionIndex(pageDownKey, 25, 30), 29)
})

test("nextListSelectionIndex handles home", () => {
  const homeKey = "\x1b[H"
  assert.equal(nextListSelectionIndex(homeKey, 5, 10), 0)
  assert.equal(nextListSelectionIndex(homeKey, 0, 10), 0)
})

test("nextListSelectionIndex handles end", () => {
  const endKey = "\x1b[F"
  assert.equal(nextListSelectionIndex(endKey, 0, 10), 9)
  assert.equal(nextListSelectionIndex(endKey, 9, 10), 9)
})

test("nextListSelectionIndex returns undefined for unrecognized keys", () => {
  assert.equal(nextListSelectionIndex("x", 0, 10), undefined)
  assert.equal(nextListSelectionIndex("a", 5, 10), undefined)
})

test("nextListSelectionIndex handles k/j keys", () => {
  assert.equal(nextListSelectionIndex("k", 5, 10), 4)
  assert.equal(nextListSelectionIndex("j", 5, 10), 6)
})

// --- nextListScroll ---

test("nextListScroll keeps selection visible at top of window", () => {
  assert.equal(nextListScroll(0, 0, 20, 10), 0)
})

test("nextListScroll adjusts when selection goes above scroll", () => {
  assert.equal(nextListScroll(2, 5, 20, 10), 0)
})

test("nextListScroll adjusts when selection goes below visible window", () => {
  assert.equal(nextListScroll(15, 0, 20, 10), 6)
})

test("nextListScroll clamps to max scroll", () => {
  assert.equal(nextListScroll(19, 10, 20, 10), 10)
})

test("nextListScroll centers selection when possible", () => {
  assert.equal(nextListScroll(10, 0, 30, 10), 1)
})

test("nextListScroll handles single item list", () => {
  assert.equal(nextListScroll(0, 0, 1, 10), 0)
})

// --- isPrintableInput ---

test("isPrintableInput returns true for printable characters", () => {
  assert.equal(isPrintableInput("a"), true)
  assert.equal(isPrintableInput("Z"), true)
  assert.equal(isPrintableInput("1"), true)
  assert.equal(isPrintableInput("!"), true)
  assert.equal(isPrintableInput(" "), true)
})

test("isPrintableInput returns false for non-printable inputs", () => {
  assert.equal(isPrintableInput(""), false)
  assert.equal(isPrintableInput("\x1b"), false)
  assert.equal(isPrintableInput("\x1b[A"), false)
  assert.equal(isPrintableInput("\x7f"), false)
})

// --- isEnter ---

test("isEnter recognizes enter/return variants", () => {
  assert.equal(isEnter("\r"), true)
  assert.equal(isEnter("\n"), true)
})

// --- FilterableListState ---

test("FilterableListState filters items by search query", () => {
  const state = new FilterableListState(["alpha", "beta", "alphabet"], (item) => item)
  state.searchQuery = "alpha"
  assert.deepEqual(state.filteredItems, ["alpha", "alphabet"])
})

test("FilterableListState resets selection and scroll when search changes", () => {
  const state = new FilterableListState(["alpha", "beta"], (item) => item)
  state.selectedIndex = 1
  state.scroll = 1
  state.appendSearchChar("a")
  assert.equal(state.searchQuery, "a")
  assert.equal(state.selectedIndex, 0)
  assert.equal(state.scroll, 0)
  state.backspaceSearch()
  assert.equal(state.searchQuery, "")
})

test("FilterableListState search deletion removes a complete grapheme", () => {
  const state = new FilterableListState(["éclair"], (item) => item)
  state.appendSearchChar("e\u0301")

  state.backspaceSearch()

  assert.equal(state.searchQuery, "")
})

test("FilterableListState clamps selection and returns visible items", () => {
  const state = new FilterableListState(["a", "b", "c"], (item) => item)
  state.selectedIndex = 10
  state.clampSelection()
  assert.equal(state.selectedIndex, 2)
  state.scroll = 0
  assert.deepEqual(state.visibleItems(2), [
    { item: "b", index: 1 },
    { item: "c", index: 2 },
  ])
})
