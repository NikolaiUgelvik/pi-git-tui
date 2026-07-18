import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyBuild, writeBuildManifest } from "./build-metadata.mjs"
import { verifiedTypeScriptVersion } from "./compiler-metadata.mjs"
import { normalizeEmittedText } from "./normalize-emitted-text.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distPath = resolve(root, "dist")
const tscPath = resolve(root, "node_modules/typescript/bin/tsc")

function fail(message) {
  console.error(`pi-git build failed: ${message}`)
  process.exitCode = 1
}

try {
  const typescriptVersion = verifiedTypeScriptVersion(root)

  rmSync(distPath, { recursive: true, force: true })
  const result = spawnSync(process.execPath, [tscPath, "-p", resolve(root, "tsconfig.build.json")], {
    cwd: root,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`TypeScript was terminated by ${result.signal}`)
  if (result.status !== 0) throw new Error(`TypeScript exited with status ${result.status}`)

  normalizeEmittedText(distPath)
  writeBuildManifest(root, typescriptVersion)
  const manifest = verifyBuild(root, { compilerVersion: typescriptVersion })
  console.log(`Built ${manifest.outputs.length} production files with ${manifest.compiler}.`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
