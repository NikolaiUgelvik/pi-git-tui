import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { assertCompiledBuildIsConsistent } from "../src/build-freshness.js"

interface FileRecord {
  path: string
  bytes: number
  sha256: string
}

function write(root: string, path: string, contents: string): void {
  const absolutePath = join(root, path)
  mkdirSync(join(absolutePath, ".."), { recursive: true })
  writeFileSync(absolutePath, contents)
}

function record(root: string, path: string): FileRecord {
  const contents = readFileSync(join(root, path))
  return {
    path,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  }
}

function createBuildFixture(): { entryUrl: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-git-tui-build-freshness-"))
  const inputPaths = [
    ".gitattributes",
    "extensions/diff.ts",
    "package.json",
    "src/example.ts",
    "tsconfig.build.json",
    "tsconfig.json",
  ].sort()
  const outputPaths = ["dist/extensions/diff.js"]

  write(root, ".gitattributes", "* text eol=lf\n")
  write(root, "extensions/diff.ts", 'export { default } from "../src/example.js"\n')
  write(root, "package-lock.json", '{"lockfileVersion":3,"packages":{"node_modules/typescript":{"version":"5.9.3"}}}\n')
  write(root, "package.json", '{"type":"module"}\n')
  write(root, "src/example.ts", "export default function example() {}\n")
  write(root, "tsconfig.build.json", "{}\n")
  write(root, "tsconfig.json", "{}\n")
  write(root, outputPaths[0], "export default function example() {}\n")
  write(
    root,
    "dist/build-manifest.json",
    `${JSON.stringify(
      {
        version: 1,
        compiler: "typescript@5.9.3",
        inputs: inputPaths.map((path) => record(root, path)),
        outputs: outputPaths.map((path) => record(root, path)),
      },
      null,
      2,
    )}\n`,
  )

  return { entryUrl: pathToFileURL(join(root, outputPaths[0])).href, root }
}

test("accepts a complete compiled build", () => {
  const fixture = createBuildFixture()
  try {
    assert.doesNotThrow(() => assertCompiledBuildIsConsistent(fixture.entryUrl))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects compiled output after a source input changes", () => {
  const fixture = createBuildFixture()
  try {
    write(fixture.root, "src/example.ts", "export default function changed() {}\n")
    assert.throws(
      () => assertCompiledBuildIsConsistent(fixture.entryUrl),
      /inconsistent compiled output.*src\/example\.ts/,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects a manifest that self-attests the wrong compiler", () => {
  const fixture = createBuildFixture()
  try {
    const manifestPath = join(fixture.root, "dist/build-manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    manifest.compiler = "typescript@0.0.0"
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    assert.throws(() => assertCompiledBuildIsConsistent(fixture.entryUrl), /manifest compiler.*does not match/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("accepts lockfile metadata rewrites when the compiler is unchanged", () => {
  const fixture = createBuildFixture()
  try {
    write(
      fixture.root,
      "package-lock.json",
      `${JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "node_modules/typescript": {
              version: "5.9.3",
              os: ["darwin", "linux"],
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    assert.doesNotThrow(() => assertCompiledBuildIsConsistent(fixture.entryUrl))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects a changed compiler lock", () => {
  const fixture = createBuildFixture()
  try {
    write(
      fixture.root,
      "package-lock.json",
      '{"lockfileVersion":3,"packages":{"node_modules/typescript":{"version":"5.8.0"}}}\n',
    )
    assert.throws(() => assertCompiledBuildIsConsistent(fixture.entryUrl), /manifest compiler.*does not match/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects a mixed or modified output tree", () => {
  const fixture = createBuildFixture()
  try {
    write(fixture.root, "dist/extensions/diff.js", "export default function stale() {}\n")
    assert.throws(
      () => assertCompiledBuildIsConsistent(fixture.entryUrl),
      /inconsistent compiled output.*dist\/extensions\/diff\.js/,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects a missing emitted output", () => {
  const fixture = createBuildFixture()
  try {
    rmSync(join(fixture.root, "dist/extensions/diff.js"))
    assert.throws(
      () => assertCompiledBuildIsConsistent(fixture.entryUrl),
      /inconsistent compiled output.*output file list changed/,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("rejects an extra stale output in a mixed build tree", () => {
  const fixture = createBuildFixture()
  try {
    write(fixture.root, "dist/src/stale.js", "export const stale = true\n")
    assert.throws(
      () => assertCompiledBuildIsConsistent(fixture.entryUrl),
      /inconsistent compiled output.*output file list changed/,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("packed output verifies without unpublished TypeScript sources", () => {
  const fixture = createBuildFixture()
  try {
    rmSync(join(fixture.root, "src"), { recursive: true })
    rmSync(join(fixture.root, "extensions"), { recursive: true })
    assert.doesNotThrow(() => assertCompiledBuildIsConsistent(fixture.entryUrl))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
