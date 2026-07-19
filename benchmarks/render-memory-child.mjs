import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"

const modulePath = process.argv[2]
if (!modulePath || typeof globalThis.gc !== "function") {
  throw new Error("usage: node --expose-gc render-memory-child.mjs <viewer-render-cache.js>")
}

const cacheModuleUrl = pathToFileURL(modulePath)
const {
  MAX_CURRENT_DIFF_ROWS,
  MAX_CURRENT_DIFF_WEIGHT_BYTES,
  MAX_RETAINED_DIFF_ROWS,
  MAX_RETAINED_DIFF_WEIGHT_BYTES,
  ViewerRenderCache,
} = await import(cacheModuleUrl)
const { prepareDiffPresentation } = await import(new URL("./diff-presentation.js", cacheModuleUrl))

const theme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
}
const syntax = {
  languageFromPath: () => undefined,
  highlight: (code) => code.split("\n"),
}
const presenter = (diffFile) => prepareDiffPresentation(diffFile, theme, syntax)

function file(index, lines) {
  const path = `historical-${index}.txt`
  return {
    path,
    status: "modified",
    staged: false,
    lines: [`diff --git a/${path} b/${path}`, `@@ -1,${lines} +1,${lines} @@`, ...Array(lines).fill(" context")],
  }
}

const cache = new ViewerRenderCache([], presenter)
globalThis.gc()
const baseline = process.memoryUsage()
for (let index = 0; index < 30; index++) {
  cache.replaceDocument([file(index, index % 2 === 0 ? 10_000 : MAX_RETAINED_DIFF_ROWS + 1)])
  cache.selectedFileDisplay(0)
  globalThis.gc()
}
const manyFiles = Array.from({ length: 12 }, (_, index) => file(index, 10_000))
const oversized = file(999, MAX_RETAINED_DIFF_ROWS + 1)
cache.replaceDocument([...manyFiles, oversized])
for (let index = 0; index < manyFiles.length; index++) cache.selectedFileDisplay(index)
cache.selectedFileDisplay(manyFiles.length)
cache.selectedFileDisplay(manyFiles.length)
globalThis.gc()
const final = process.memoryUsage()
const stats = cache.stats()
const retainedHeapGrowthBytes = Math.max(0, final.heapUsed - baseline.heapUsed)
assert(stats.retainedSelectedFileRows <= MAX_RETAINED_DIFF_ROWS)
assert(stats.retainedSelectedFileWeightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES)
assert(stats.currentSelectedFileRows <= MAX_CURRENT_DIFF_ROWS)
assert(stats.currentSelectedFileWeightBytes <= MAX_CURRENT_DIFF_WEIGHT_BYTES)
assert(stats.selectedFileDisplaySkips >= 15, "oversized displays were unexpectedly retained in the LRU")
assert(stats.selectedFileDisplayPins >= 15, "oversized displays were not pinned in the current slot")
assert(stats.selectedFileDisplayHits >= 1, "current-slot presentation was not reused")
assert(retainedHeapGrowthBytes <= 128 * 1024 * 1024, "render cache retained more than 128 MiB after GC")
process.stdout.write(
  `${JSON.stringify({
    absoluteRssBytes: final.rss,
    absoluteHeapUsedBytes: final.heapUsed,
    retainedHeapGrowthBytes,
    cacheStats: stats,
  })}\n`,
)
