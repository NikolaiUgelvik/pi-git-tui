import assert from "node:assert/strict"
import { test } from "node:test"
import type { DiffDisplayRow } from "../src/diff-display.js"
import { type ChangedSpan, INTRALINE_LIMITS, planIntralineChanges } from "../src/diff-intraline.js"

const hunk: DiffDisplayRow = { type: "hunk", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }

function changeRows(oldLines: readonly string[], newLines: readonly string[]): DiffDisplayRow[] {
  return [
    hunk,
    ...oldLines.map((text, index): DiffDisplayRow => ({ type: "deletion", marker: "-", lineNumber: index + 1, text })),
    ...newLines.map((text, index): DiffDisplayRow => ({ type: "addition", marker: "+", lineNumber: index + 1, text })),
  ]
}

function plan(oldLines: readonly string[], newLines: readonly string[]) {
  const rows = changeRows(oldLines, newLines)
  return {
    rows,
    plan: planIntralineChanges(
      rows,
      rows.map((row) => ("text" in row ? row.text : "")),
    ),
  }
}

function fragments(text: string, spans: readonly ChangedSpan[] | undefined): string[] {
  return spans?.map((span) => text.slice(span.start, span.end)) ?? []
}

function changedFragments(
  rows: readonly DiffDisplayRow[],
  spansByRow: ReturnType<typeof planIntralineChanges>["spansByRow"],
) {
  return rows.map((row, index) => ("text" in row ? fragments(row.text, spansByRow[index]) : []))
}

test("bounded line alignment handles inserted lines and unequal runs", () => {
  const { rows, plan: result } = plan(
    ["const alpha = 1", "const beta = 2"],
    ["const inserted = 0", "const alpha = 1", "const beta = 3"],
  )

  assert.deepEqual(changedFragments(rows, result.spansByRow), [
    [],
    [],
    ["2"],
    ["const", "inserted", "=", "0"],
    [],
    ["3"],
  ])
})

test("token changes preserve punctuation and ignore whitespace-only differences", () => {
  const punctuation = plan("call(foo, oldValue);".split("\n"), "call(foo, newValue)!".split("\n"))
  assert.deepEqual(changedFragments(punctuation.rows, punctuation.plan.spansByRow), [
    [],
    ["oldValue", ";"],
    ["newValue", "!"],
  ])

  const whitespace = plan(["alpha beta\t"], ["alpha  beta    "])
  assert.deepEqual(changedFragments(whitespace.rows, whitespace.plan.spansByRow), [[], [], []])
})

test("blank and exact lines have no stronger decoration", () => {
  const { rows, plan: result } = plan(["", "same"], ["", "same"])
  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], [], [], [], []])
})

test("changed spans stay aligned to Unicode graphemes", () => {
  const oldText = "e\u0301 界 🇺🇦 👍🏽 👨‍👩‍👧‍👦"
  const newText = "e\u0301 字 🇺🇦 👍🏻 👨‍👩‍👧‍👦"
  const { rows, plan: result } = plan([oldText], [newText])

  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], ["界", "👍🏽"], ["字", "👍🏻"]])
  for (const [index, row] of rows.entries()) {
    if (!("text" in row)) continue
    for (const span of result.spansByRow[index] ?? []) {
      assert.equal(
        [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(row.text)].some(
          ({ index }) => index === span.start,
        ),
        true,
      )
    }
  }
})

test("repeated tokens use deterministic alignment", () => {
  const first = plan(["value + value + old"], ["value + value + next"])
  const second = plan(["value + value + old"], ["value + value + next"])
  assert.deepEqual(first.plan, second.plan)
  assert.deepEqual(changedFragments(first.rows, first.plan.spansByRow), [[], ["old"], ["next"]])
})

test("unrelated replacements mark non-whitespace tokens without positional zipping", () => {
  const { rows, plan: result } = plan(["alpha one", "beta two"], ["totally different"])
  assert.deepEqual(changedFragments(rows, result.spansByRow), [
    [],
    ["alpha", "one"],
    ["beta", "two"],
    ["totally", "different"],
  ])
})

test("one-sided, malformed, context-separated, and conflict runs are barriers", () => {
  const cases: DiffDisplayRow[][] = [
    [hunk, { type: "deletion", marker: "-", lineNumber: 1, text: "old" }],
    [
      hunk,
      { type: "addition", marker: "+", lineNumber: 1, text: "new" },
      { type: "deletion", marker: "-", lineNumber: 1, text: "old" },
    ],
    [
      hunk,
      { type: "deletion", marker: "-", lineNumber: 1, text: "old" },
      { type: "context", marker: " ", lineNumber: 2, text: "barrier" },
      { type: "addition", marker: "+", lineNumber: 1, text: "new" },
    ],
    [
      hunk,
      { type: "deletion", marker: "-", lineNumber: 1, text: "old" },
      { type: "deletion", marker: "-", lineNumber: 2, text: "<<<<<<< ours" },
      { type: "addition", marker: "+", lineNumber: 1, text: "new" },
    ],
  ]
  for (const rows of cases) {
    const result = planIntralineChanges(
      rows,
      rows.map((row) => ("text" in row ? row.text : "")),
    )
    assert.equal(
      result.spansByRow.every((spans) => spans === undefined),
      true,
    )
  }
})

test("span reconstruction never changes normalized line content", () => {
  const { rows, plan: result } = plan(["prefix old suffix"], ["prefix new suffix"])
  for (const [index, row] of rows.entries()) {
    if (!("text" in row)) continue
    let cursor = 0
    let reconstructed = ""
    for (const span of result.spansByRow[index] ?? []) {
      reconstructed += row.text.slice(cursor, span.start) + row.text.slice(span.start, span.end)
      cursor = span.end
    }
    reconstructed += row.text.slice(cursor)
    assert.equal(reconstructed, row.text)
  }
})

test("declared conservative limits remain fixed", () => {
  assert.deepEqual(INTRALINE_LIMITS, {
    lineUtf16Units: 8_192,
    graphemesPerLine: 1_024,
    tokensPerLine: 256,
    rowsPerRun: 128,
    linesPerSide: 64,
    tokensPerRun: 4_096,
    lineAlignmentCellsPerRun: 4_225,
    tokenLcsCellsPerPair: 16_384,
    tokenLcsCellsPerRun: 65_536,
    changeRowsPerFile: 4_096,
    changeRunsPerFile: 256,
    tokensPerFile: 65_536,
    alignmentCellsPerFile: 65_536,
    tokenLcsCellsPerFile: 262_144,
  })
})

test("token and line-run boundaries use deterministic fallback one over", () => {
  const atLcsCellLimit = `${"!".repeat(126)}a`
  const lcsResult = plan([atLcsCellLimit], [`${"!".repeat(126)}b`])
  assert.deepEqual(changedFragments(lcsResult.rows, lcsResult.plan.spansByRow).slice(-2), [["a"], ["b"]])

  const atTokenLimit = `${"!".repeat(INTRALINE_LIMITS.tokensPerLine - 1)}a`
  const tokenResult = plan([atTokenLimit], [`${"!".repeat(INTRALINE_LIMITS.tokensPerLine - 1)}b`])
  assert.equal(
    tokenResult.plan.spansByRow.every((spans) => spans === undefined),
    true,
  )

  const overTokenLimit = "!".repeat(INTRALINE_LIMITS.tokensPerLine + 1)
  const overResult = plan([overTokenLimit], [`${overTokenLimit.slice(0, -1)}?`])
  assert.equal(
    overResult.plan.spansByRow.every((spans) => spans === undefined),
    true,
  )

  const oldAtLimit = Array.from({ length: INTRALINE_LIMITS.linesPerSide }, (_, index) => `line ${index}`)
  const newAtLimit = oldAtLimit.map((line, index) => (index === oldAtLimit.length - 1 ? "line changed" : line))
  const lineResult = plan(oldAtLimit, newAtLimit)
  assert.deepEqual(fragments(newAtLimit.at(-1) ?? "", lineResult.plan.spansByRow.at(-1)), ["changed"])

  const overLines = [...oldAtLimit, "one over"]
  const changedOverLines = overLines.map((line, index) => (index === overLines.length - 1 ? "changed over" : line))
  const overLineResult = plan(overLines, changedOverLines)
  assert.equal(
    overLineResult.plan.spansByRow.every((spans) => spans === undefined),
    true,
  )
})

test("file run count accepts the limit and discards all work one over", () => {
  const rows: DiffDisplayRow[] = [hunk]
  for (let index = 0; index < INTRALINE_LIMITS.changeRunsPerFile; index++) {
    rows.push(
      { type: "deletion", marker: "-", lineNumber: index + 1, text: `old${index}` },
      { type: "addition", marker: "+", lineNumber: index + 1, text: `new${index}` },
      { type: "context", marker: " ", lineNumber: index + 2, text: "barrier" },
    )
  }
  const texts = rows.map((row) => ("text" in row ? row.text : ""))
  assert.equal(
    planIntralineChanges(rows, texts).spansByRow.some((spans) => spans !== undefined),
    true,
  )
  rows.push(
    { type: "deletion", marker: "-", lineNumber: 999, text: "old" },
    { type: "addition", marker: "+", lineNumber: 999, text: "new" },
  )
  const over = planIntralineChanges(
    rows,
    rows.map((row) => ("text" in row ? row.text : "")),
  )
  assert.equal(
    over.spansByRow.every((spans) => spans === undefined),
    true,
  )
})
