import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

interface BuildFileRecord {
  path: string
  bytes: number
  sha256: string
}

interface BuildManifest {
  version: 1
  compiler: string
  inputs: BuildFileRecord[]
  outputs: BuildFileRecord[]
}

const BUILD_MANIFEST_PATH = "dist/build-manifest.json"
const BUILD_INPUT_FILES = [
  ".gitattributes",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
]
const BUILD_INPUT_DIRECTORIES = [
  { directory: "extensions", suffix: ".ts" },
  { directory: "scripts", suffix: ".mjs" },
  { directory: "src", suffix: ".ts" },
]

function toPosixPath(path: string): string {
  return path.split(sep).join("/")
}

function collectFiles(root: string, directory: string, accepts: (path: string) => boolean): string[] {
  const firstDirectory = resolve(root, directory)
  if (!existsSync(firstDirectory)) return []
  const pending = [firstDirectory]
  const paths: string[] = []
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name)
      const relativePath = toPosixPath(relative(root, absolutePath))
      if (entry.isDirectory()) pending.push(absolutePath)
      else if (entry.isFile() && accepts(relativePath)) paths.push(relativePath)
    }
  }
  return paths
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortedUnique(paths: string[]): string[] {
  return [...new Set(paths)].sort(comparePaths)
}

function collectInputPaths(root: string): string[] {
  const fixedFiles = BUILD_INPUT_FILES.filter((path) => existsSync(resolve(root, path)))
  const sourceFiles = BUILD_INPUT_DIRECTORIES.flatMap(({ directory, suffix }) =>
    collectFiles(root, directory, (path) => path.endsWith(suffix)),
  )
  return sortedUnique([...fixedFiles, ...sourceFiles])
}

function collectOutputPaths(root: string): string[] {
  return sortedUnique(collectFiles(root, "dist", (path) => path !== BUILD_MANIFEST_PATH))
}

function resolveContainedPath(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(root, relativePath)
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`manifest path escapes the package root: ${relativePath}`)
  }
  return absolutePath
}

function fileRecord(root: string, path: string): BuildFileRecord {
  const contents = readFileSync(resolveContainedPath(root, path))
  return {
    path,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  }
}

function parseManifest(root: string): BuildManifest {
  const value: unknown = JSON.parse(readFileSync(resolve(root, BUILD_MANIFEST_PATH), "utf8"))
  if (!value || typeof value !== "object") throw new Error("build manifest is not an object")

  const manifest = value as Partial<BuildManifest>
  if (
    manifest.version !== 1 ||
    typeof manifest.compiler !== "string" ||
    !Array.isArray(manifest.inputs) ||
    !Array.isArray(manifest.outputs)
  ) {
    throw new Error("build manifest has an unsupported shape")
  }
  return manifest as BuildManifest
}

function requireRuntimeRecord(record: BuildFileRecord, kind: string): BuildFileRecord {
  if (typeof record?.path !== "string") throw new Error(`build manifest has an invalid ${kind} path`)
  if (typeof record.bytes !== "number") throw new Error(`build manifest has invalid ${kind} bytes`)
  if (typeof record.sha256 !== "string") throw new Error(`build manifest has an invalid ${kind} hash`)
  return record
}

function verifyManifestFiles(root: string, kind: string, actualPaths: string[], candidates: BuildFileRecord[]): void {
  const records = candidates.map((record) => requireRuntimeRecord(record, kind))
  if (actualPaths.length !== records.length) {
    throw new Error(`${kind} file list changed (expected ${records.length}, found ${actualPaths.length})`)
  }
  for (const [index, record] of records.entries()) {
    const path = actualPaths[index]
    if (path !== record.path) throw new Error(`${kind} file list changed near ${path ?? record.path}`)
    const actual = fileRecord(root, record.path)
    if (actual.bytes === record.bytes && actual.sha256 === record.sha256) continue
    throw new Error(`${kind} file differs from the build manifest: ${record.path}`)
  }
}

function packageRootForCompiledEntry(entryUrl: string): string | undefined {
  const entryPath = fileURLToPath(entryUrl)
  const extensionDirectory = dirname(entryPath)
  const distDirectory = dirname(extensionDirectory)
  if (basename(extensionDirectory) !== "extensions" || basename(distDirectory) !== "dist") return undefined
  return dirname(distDirectory)
}

function hasSourceCheckout(root: string): boolean {
  return existsSync(resolve(root, "src")) || existsSync(resolve(root, "extensions/diff.ts"))
}

function lockedCompiler(root: string): string {
  const lock: unknown = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"))
  const version = (lock as { packages?: Record<string, { version?: unknown }> }).packages?.["node_modules/typescript"]
    ?.version
  if (typeof version !== "string" || !version) throw new Error("package-lock.json does not pin TypeScript")
  return `typescript@${version}`
}

function verifyCompiledBuild(root: string): void {
  const manifest = parseManifest(root)
  verifyManifestFiles(root, "output", collectOutputPaths(root), manifest.outputs)

  if (hasSourceCheckout(root)) {
    const compiler = lockedCompiler(root)
    if (manifest.compiler !== compiler) {
      throw new Error(`manifest compiler ${manifest.compiler} does not match ${compiler}`)
    }
    verifyManifestFiles(root, "input", collectInputPaths(root), manifest.inputs)
  }
}

export function assertCompiledBuildIsConsistent(entryUrl: string): void {
  const root = packageRootForCompiledEntry(entryUrl)
  if (!root) return

  try {
    verifyCompiledBuild(root)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `pi-git-tui refused to load missing or inconsistent compiled output: ${detail}. ` +
        `Run "npm run build" in ${root}; use "npm run dev" to load TypeScript source during development.`,
      { cause: error },
    )
  }
}
