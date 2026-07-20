import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const coveragePath = resolve(root, ".tmp-coverage/coverage-final.json")

function replaceNegativeLocations(value) {
  if (Array.isArray(value)) {
    value.forEach(replaceNegativeLocations)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number" && child < 0) value[key] = 0
    else replaceNegativeLocations(child)
  }
}

try {
  const coverage = JSON.parse(readFileSync(coveragePath, "utf8"))
  replaceNegativeLocations(coverage)
  writeFileSync(coveragePath, `${JSON.stringify(coverage)}\n`)
} catch (error) {
  console.error(`pi-git-tui coverage sanitation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
