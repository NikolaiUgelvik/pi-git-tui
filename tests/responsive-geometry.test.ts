import assert from "node:assert/strict"
import { test } from "node:test"
import { measureOverlayGeometry, measureViewerGeometry } from "../src/responsive-geometry.js"

const widths = [30, 50, 70, 120]
const terminalRows = [10, 16, 24]

test("viewer and overlay geometry stay inside the terminal matrix", () => {
  for (const width of widths) {
    for (const rows of terminalRows) {
      const geometry = measureViewerGeometry({ width, terminalRows: rows, focusedPanel: "diff", empty: false })
      assert.equal(geometry.width, width)
      assert.equal(geometry.height, rows - 2)
      assert.ok(geometry.bodyRows >= 1)
      assert.equal(geometry.layout, width >= 72 ? "split" : "single")
      if (geometry.layout === "split") {
        assert.equal(geometry.treeWidth + geometry.separatorWidth + geometry.diffWidth, geometry.innerWidth)
      } else {
        assert.equal(geometry.diffWidth, geometry.innerWidth)
        assert.equal(geometry.treeWidth, 0)
      }

      const overlay = measureOverlayGeometry({ width, height: geometry.height })
      assert.ok(overlay.width <= width)
      assert.ok(overlay.height <= geometry.height)
      assert.ok(overlay.left >= 0)
      assert.ok(overlay.top >= 0)
      assert.ok(overlay.left + overlay.width <= width)
      assert.ok(overlay.top + overlay.height <= geometry.height)
      assert.ok(overlay.bodyRows >= 1)
    }
  }
})

test("empty documents use one full-width panel at every supported width", () => {
  for (const width of widths) {
    const geometry = measureViewerGeometry({ width, terminalRows: 24, focusedPanel: "tree", empty: true })
    assert.equal(geometry.layout, "empty")
    assert.equal(geometry.mainWidth, width - 2)
  }
})

test("very small dimensions select a bounded too-small state", () => {
  const short = measureViewerGeometry({ width: 30, terminalRows: 7, focusedPanel: "tree", empty: false })
  const narrow = measureViewerGeometry({ width: 10, terminalRows: 24, focusedPanel: "tree", empty: false })

  assert.equal(short.layout, "too-small")
  assert.equal(short.height, 5)
  assert.equal(narrow.layout, "too-small")
  assert.equal(narrow.width, 10)
})
