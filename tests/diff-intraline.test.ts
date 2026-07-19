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

test("unequal added and deleted counts do not receive intraline highlights", () => {
  const { rows, plan: result } = plan(
    ["pub fn make_exif_orientation_6_jpeg(path: &Path) {", "fs::write(path, EXIF_ORIENTATION_6_JPEG).unwrap();"],
    [
      "pub fn make_exif_orientation_jpeg(path: &Path, orientation: u8) {",
      "let mut jpeg = EXIF_ORIENTATION_6_JPEG.to_vec();",
      "jpeg[31] = orientation;",
      "fs::write(path, jpeg).unwrap();",
    ],
  )

  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], [], [], [], [], [], []])
})

test("equal change blocks pair lines positionally", () => {
  const { rows, plan: result } = plan(["const alpha = 1", "const beta = 2"], ["const inserted = 0", "const beta = 3"])

  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], ["alpha = 1"], ["2"], ["inserted = 0"], ["3"]])
})

test("paired lines highlight one range after their common prefix and suffix", () => {
  const { rows, plan: result } = plan(
    ["support::make_exif_orientation_6_jpeg(&layer);"],
    ["support::make_exif_orientation_jpeg(&layer, 6);"],
  )

  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], ["6_jpeg(&layer"], ["jpeg(&layer, 6"]])
})

test("insertions and deletions can decorate only one side", () => {
  const insertion = plan(["prefix suffix"], ["prefix new suffix"])
  assert.deepEqual(changedFragments(insertion.rows, insertion.plan.spansByRow), [[], [], ["new "]])

  const deletion = plan(["prefix old suffix"], ["prefix suffix"])
  assert.deepEqual(changedFragments(deletion.rows, deletion.plan.spansByRow), [[], ["old "], []])
})

test("blank and exact lines have no stronger decoration", () => {
  const { rows, plan: result } = plan(["", "same"], ["", "same"])
  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], [], [], [], []])
})

test("changed spans stay aligned to Unicode graphemes", () => {
  const oldText = "prefix 👍🏽 suffix"
  const newText = "prefix 👍🏻 suffix"
  const { rows, plan: result } = plan([oldText], [newText])

  assert.deepEqual(changedFragments(rows, result.spansByRow), [[], ["👍🏽"], ["👍🏻"]])
  for (const [index, row] of rows.entries()) {
    if (!("text" in row)) continue
    const boundaries = new Set([
      ...[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(row.text)].map(({ index }) => index),
      row.text.length,
    ])
    for (const span of result.spansByRow[index] ?? []) {
      assert.equal(boundaries.has(span.start), true)
      assert.equal(boundaries.has(span.end), true)
    }
  }
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
    lineUtf16Units: 1_024,
    graphemesPerLine: 1_024,
    rowsPerRun: 128,
    linesPerSide: 64,
    changeRowsPerFile: 4_096,
    changeRunsPerFile: 256,
    graphemesPerFile: 65_536,
  })
})

test("line and run boundaries use deterministic fallback one over", () => {
  const atLineLimit = `${"a".repeat(INTRALINE_LIMITS.lineUtf16Units - 1)}x`
  const lineResult = plan([atLineLimit], [`${atLineLimit.slice(0, -1)}y`])
  assert.deepEqual(changedFragments(lineResult.rows, lineResult.plan.spansByRow).slice(-2), [["x"], ["y"]])

  const overLineLimit = `${atLineLimit}x`
  const overLineResult = plan([overLineLimit], [`${overLineLimit.slice(0, -1)}y`])
  assert.equal(
    overLineResult.plan.spansByRow.every((spans) => spans === undefined),
    true,
  )

  const oldAtLimit = Array.from({ length: INTRALINE_LIMITS.linesPerSide }, (_, index) => `line ${index}`)
  const newAtLimit = oldAtLimit.map((line, index) => (index === oldAtLimit.length - 1 ? "line changed" : line))
  const runResult = plan(oldAtLimit, newAtLimit)
  assert.deepEqual(fragments(newAtLimit.at(-1) ?? "", runResult.plan.spansByRow.at(-1)), ["changed"])

  const overLines = [...oldAtLimit, "one over"]
  const overRunResult = plan(
    overLines,
    overLines.map((line) => `${line}!`),
  )
  assert.equal(
    overRunResult.plan.spansByRow.every((spans) => spans === undefined),
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
