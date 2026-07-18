import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function lockedTypeScriptVersion(root) {
  const lock = readJson(resolve(root, "package-lock.json"))
  const version = lock?.packages?.["node_modules/typescript"]?.version
  if (typeof version !== "string" || !version) {
    throw new Error("package-lock.json does not pin node_modules/typescript")
  }
  return version
}

function installedTypeScriptVersion(root) {
  const installed = readJson(resolve(root, "node_modules/typescript/package.json"))
  if (typeof installed?.version !== "string" || !installed.version) {
    throw new Error("the installed TypeScript package has no version")
  }
  return installed.version
}

export function verifiedTypeScriptVersion(root) {
  const locked = lockedTypeScriptVersion(root)
  const installed = installedTypeScriptVersion(root)
  if (installed !== locked) {
    throw new Error(`installed TypeScript ${installed} does not match package-lock.json ${locked}`)
  }
  return locked
}
