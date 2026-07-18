import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyBuild } from "./build-metadata.mjs"
import { lockedTypeScriptVersion, verifiedTypeScriptVersion } from "./compiler-metadata.mjs"
import { verifyReproducibleBuild } from "./reproducible-build.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

try {
  const canCompile = existsSync(resolve(root, "node_modules/typescript/bin/tsc"))
  const compilerVersion = canCompile ? verifiedTypeScriptVersion(root) : lockedTypeScriptVersion(root)
  const manifest = verifyBuild(root, { compilerVersion })
  if (canCompile) verifyReproducibleBuild(root, compilerVersion)
  const mode = canCompile ? "reproducible" : "manifest-verified"
  console.log(`Verified ${manifest.inputs.length} inputs and ${manifest.outputs.length} ${mode} production files.`)
} catch (error) {
  console.error(`pi-git compiled output is missing or stale: ${error instanceof Error ? error.message : String(error)}`)
  console.error('Run "npm run build" before installing or packaging pi-git.')
  process.exitCode = 1
}
