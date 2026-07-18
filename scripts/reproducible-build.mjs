import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { collectBuildInputPaths, collectBuildOutputPaths, writeBuildManifest } from "./build-metadata.mjs"
import { normalizeEmittedText } from "./normalize-emitted-text.mjs"

const MANIFEST_PATH = "dist/build-manifest.json"

function copyInputs(root, temporaryRoot) {
  for (const path of collectBuildInputPaths(root)) {
    const target = resolve(temporaryRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(resolve(root, path), target)
  }
  symlinkSync(
    resolve(root, "node_modules"),
    resolve(temporaryRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
}

function compile(root, temporaryRoot) {
  const tscPath = resolve(root, "node_modules/typescript/bin/tsc")
  const result = spawnSync(process.execPath, [tscPath, "-p", resolve(temporaryRoot, "tsconfig.build.json")], {
    cwd: temporaryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`reproducibility build was terminated by ${result.signal}`)
  if (result.status !== 0) {
    throw new Error(
      [`reproducibility build exited with status ${result.status}`, result.stdout, result.stderr].join("\n"),
    )
  }
}

function compareFile(root, temporaryRoot, path) {
  const checked = readFileSync(resolve(root, path))
  const rebuilt = readFileSync(resolve(temporaryRoot, path))
  if (!checked.equals(rebuilt)) throw new Error(`canonical clean build differs from checked output: ${path}`)
}

export function verifyReproducibleBuild(root, compilerVersion) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-git-reproducible-build-"))
  try {
    copyInputs(root, temporaryRoot)
    compile(root, temporaryRoot)
    normalizeEmittedText(resolve(temporaryRoot, "dist"))
    writeBuildManifest(temporaryRoot, compilerVersion)
    const checkedPaths = [...collectBuildOutputPaths(root), MANIFEST_PATH]
    const rebuiltPaths = [...collectBuildOutputPaths(temporaryRoot), MANIFEST_PATH]
    if (JSON.stringify(checkedPaths) !== JSON.stringify(rebuiltPaths)) {
      throw new Error("canonical clean build output file list differs from checked output")
    }
    for (const path of checkedPaths) compareFile(root, temporaryRoot, path)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
