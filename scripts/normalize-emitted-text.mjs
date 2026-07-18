import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

function isEmittedText(path) {
  return path.endsWith(".js") || path.endsWith(".d.ts") || path.endsWith(".js.map")
}

export function normalizeEmittedText(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      normalizeEmittedText(path)
      continue
    }
    if (!entry.isFile() || !isEmittedText(entry.name)) continue

    const contents = readFileSync(path, "utf8")
    const normalized = contents.replace(/\r\n/gu, "\n").replace(/[ \t]+(?=\n|$)/gu, "")
    if (normalized !== contents) writeFileSync(path, normalized)
  }
}
