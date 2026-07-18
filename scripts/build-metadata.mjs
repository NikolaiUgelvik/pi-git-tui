import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { relative, resolve, sep } from "node:path"

const BUILD_MANIFEST_RELATIVE_PATH = "dist/build-manifest.json"

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

function toPosixPath(path) {
  return path.split(sep).join("/")
}

function collectFiles(root, directory, accepts) {
  const absoluteDirectory = resolve(root, directory)
  if (!existsSync(absoluteDirectory)) return []

  const paths = []
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = toPosixPath(relative(root, resolve(absoluteDirectory, entry.name)))
    if (entry.isDirectory()) {
      paths.push(...collectFiles(root, relativePath, accepts))
    } else if (entry.isFile() && accepts(relativePath)) {
      paths.push(relativePath)
    }
  }
  return paths
}

function comparePaths(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortedUnique(paths) {
  return [...new Set(paths)].sort(comparePaths)
}

export function collectBuildInputPaths(root) {
  const fixedFiles = BUILD_INPUT_FILES.filter((path) => existsSync(resolve(root, path)))
  const sourceFiles = BUILD_INPUT_DIRECTORIES.flatMap(({ directory, suffix }) =>
    collectFiles(root, directory, (path) => path.endsWith(suffix)),
  )
  return sortedUnique([...fixedFiles, ...sourceFiles])
}

export function collectBuildOutputPaths(root) {
  return sortedUnique(collectFiles(root, "dist", (path) => path !== BUILD_MANIFEST_RELATIVE_PATH))
}

function resolveContainedPath(root, relativePath) {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(root, relativePath)
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`build manifest path escapes the package root: ${relativePath}`)
  }
  return absolutePath
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex")
}

function createFileRecord(root, path) {
  const contents = readFileSync(resolveContainedPath(root, path))
  return { path, bytes: contents.byteLength, sha256: sha256(contents) }
}

function createBuildManifest(root, compilerVersion) {
  return {
    version: 1,
    compiler: `typescript@${compilerVersion}`,
    inputs: collectBuildInputPaths(root).map((path) => createFileRecord(root, path)),
    outputs: collectBuildOutputPaths(root).map((path) => createFileRecord(root, path)),
  }
}

export function writeBuildManifest(root, compilerVersion) {
  const manifestPath = resolve(root, BUILD_MANIFEST_RELATIVE_PATH)
  const manifest = createBuildManifest(root, compilerVersion)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

function readBuildManifest(root) {
  const manifestPath = resolve(root, BUILD_MANIFEST_RELATIVE_PATH)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (
    manifest?.version !== 1 ||
    typeof manifest.compiler !== "string" ||
    !Array.isArray(manifest.inputs) ||
    !Array.isArray(manifest.outputs)
  ) {
    throw new Error("dist/build-manifest.json has an unsupported shape")
  }
  return manifest
}

function verifyPathList(kind, actualPaths, records) {
  const expectedPaths = records.map((record) => record?.path)
  if (expectedPaths.some((path) => typeof path !== "string")) {
    throw new Error(`build manifest has an invalid ${kind} path`)
  }
  if (actualPaths.length !== expectedPaths.length) {
    throw new Error(`${kind} file list changed (expected ${expectedPaths.length}, found ${actualPaths.length})`)
  }
  for (let index = 0; index < actualPaths.length; index++) {
    if (actualPaths[index] !== expectedPaths[index]) {
      throw new Error(`${kind} file list changed near ${actualPaths[index] ?? expectedPaths[index]}`)
    }
  }
}

function requireFileRecord(record, kind) {
  if (typeof record?.path !== "string") throw new Error(`build manifest has an invalid ${kind} path`)
  if (typeof record.bytes !== "number") throw new Error(`build manifest has invalid ${kind} bytes`)
  if (typeof record.sha256 !== "string") throw new Error(`build manifest has an invalid ${kind} hash`)
  return record
}

function verifyFileRecords(root, kind, records) {
  for (const candidate of records) {
    const record = requireFileRecord(candidate, kind)
    const actual = createFileRecord(root, record.path)
    if (actual.bytes === record.bytes && actual.sha256 === record.sha256) continue
    throw new Error(`${kind} file differs from the build manifest: ${record.path}`)
  }
}

function hasBuildSources(root) {
  return existsSync(resolve(root, "src")) || existsSync(resolve(root, "extensions/diff.ts"))
}

export function verifyBuild(root, options = {}) {
  const manifest = readBuildManifest(root)
  const verifyInputs = options.verifyInputs ?? hasBuildSources(root)
  if (options.compilerVersion !== undefined && manifest.compiler !== `typescript@${options.compilerVersion}`) {
    throw new Error(
      `build manifest compiler ${manifest.compiler} does not match locked TypeScript ${options.compilerVersion}`,
    )
  }

  if (verifyInputs) {
    verifyPathList("input", collectBuildInputPaths(root), manifest.inputs)
    verifyFileRecords(root, "input", manifest.inputs)
  }
  verifyPathList("output", collectBuildOutputPaths(root), manifest.outputs)
  verifyFileRecords(root, "output", manifest.outputs)

  return manifest
}
