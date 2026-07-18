import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const samples = 20
const rendersPerScenario = 100

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0
}

function summary(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function writeHeadSources(target) {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "src", "extensions"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((path) => path.endsWith(".ts"))
  for (const path of paths) {
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(
      destination,
      execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 }),
    )
  }
}

function compile(sourceRoot, outputRoot) {
  mkdirSync(outputRoot, { recursive: true })
  const configPath = join(outputRoot, "benchmark-tsconfig.json")
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          types: ["node"],
          noEmit: false,
          rootDir: sourceRoot,
          outDir: outputRoot,
        },
        include: [join(sourceRoot, "src/**/*.ts"), join(sourceRoot, "extensions/**/*.ts")],
      },
      null,
      2,
    )}\n`,
  )
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", configPath], {
    cwd: sourceRoot,
    stdio: "inherit",
  })
  writeFileSync(join(outputRoot, "package.json"), '{"type":"module"}\n')
  symlinkSync(
    join(root, "node_modules"),
    join(outputRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
}

function diffFile(path, lineCount) {
  return {
    path,
    status: "modified",
    staged: false,
    stageState: "unstaged",
    lines: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lineCount} +1,${lineCount} @@ section`,
      ...Array.from({ length: lineCount }, (_, index) =>
        index % 7 === 0 ? `+added λ ${index}` : index % 11 === 0 ? `-deleted ${index}` : ` context ${index}`,
      ),
    ],
  }
}

function filesFixture() {
  return [
    diffFile("00-large-unicode-λ.ts", 10_000),
    ...Array.from({ length: 199 }, (_, index) =>
      diffFile(`group-${index % 20}/nested-${index % 7}/file-${String(index).padStart(3, "0")}.ts`, 20),
    ),
  ]
}

function slice(scope, files = []) {
  return {
    scope,
    raw: "",
    files,
    stats: { files: files.length, additions: 0, deletions: 0 },
    omittedFileCount: 0,
    capturedPatchBytes: 0,
    capturedPatchLines: 0,
  }
}

function document(files) {
  return {
    mode: "working",
    title: "Working tree and index",
    subtitle: "/benchmark (main)",
    repositoryState: "ready",
    headState: "present",
    raw: "",
    files,
    omittedFileCount: 0,
    capturedPatchBytes: 0,
    capturedPatchLines: 0,
    staged: slice("staged"),
    working: slice("working", files),
  }
}

const theme = {
  fg: (color, text) => `\x1b[3${color.length % 8}m${text}\x1b[0m`,
  bg: (_color, text) => `\x1b[47m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
}

function viewer(Module, files) {
  class BenchmarkViewer extends Module.DiffViewer {
    cacheStats() {
      return typeof this.renderCacheStats === "function" ? this.renderCacheStats() : undefined
    }
  }
  return new BenchmarkViewer(
    {},
    { cwd: "/benchmark" },
    theme,
    document(files),
    () => {},
    () => {},
    () => 50,
  )
}

const scenarios = {
  scrolling(instance, frame) {
    instance.handleInput("\t")
    for (let index = 0; index < rendersPerScenario; index++) frame(instance, "j", 140)
  },
  sequentialBrowsing(instance, frame) {
    for (let index = 0; index < rendersPerScenario; index++) frame(instance, "n", 140)
  },
  returnBrowsing(instance, frame) {
    for (let index = 0; index < rendersPerScenario / 2; index++) {
      frame(instance, "n", 100)
      frame(instance, "p", 100)
    }
  },
  treeNavigation(instance, frame) {
    for (let index = 0; index < rendersPerScenario; index++) {
      frame(instance, index % 2 === 0 ? "j" : "k", 80)
    }
  },
}

function runFrame(instance, input, width, frameTimings, outputSequence) {
  const started = performance.now()
  instance.handleInput(input)
  const output = instance.render(width)
  frameTimings.push(performance.now() - started)
  outputSequence.update(JSON.stringify(output))
  outputSequence.update("\0")
}

function cacheHitRatio(cacheStats) {
  if (!cacheStats || cacheStats.selectedFileDisplayAccesses === 0) return null
  return cacheStats.selectedFileDisplayHits / cacheStats.selectedFileDisplayAccesses
}

function measureScenario(Module, files, operation) {
  const scenarioTimings = []
  const frameTimings = []
  let outputSequenceHash = ""
  let cacheStats
  operation(viewer(Module, files), (instance, input, width) => {
    instance.handleInput(input)
    instance.render(width)
  })
  for (let sample = 0; sample < samples; sample++) {
    const instance = viewer(Module, files)
    const sequence = createHash("sha256")
    const started = performance.now()
    operation(instance, (target, input, width) => runFrame(target, input, width, frameTimings, sequence))
    scenarioTimings.push(performance.now() - started)
    outputSequenceHash = sequence.digest("hex")
    cacheStats = instance.cacheStats()
  }
  return {
    scenarioMilliseconds: summary(scenarioTimings),
    frameMilliseconds: summary(frameTimings),
    outputSequenceHash,
    cacheStats,
    cacheHitRatio: cacheHitRatio(cacheStats),
  }
}

const workspace = mkdtempSync(join(tmpdir(), "pi-git-render-frames-"))
try {
  const currentOutput = join(workspace, "current")
  const baselineRoot = join(workspace, "baseline-source")
  const baselineOutput = join(workspace, "baseline")
  mkdirSync(baselineRoot)
  writeFileSync(join(baselineRoot, "package.json"), '{"type":"module"}\n')
  writeHeadSources(baselineRoot)
  symlinkSync(
    join(root, "node_modules"),
    join(baselineRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  compile(root, currentOutput)
  compile(baselineRoot, baselineOutput)
  const current = await import(pathToFileURL(join(currentOutput, "src/viewer.js")))
  const baseline = await import(pathToFileURL(join(baselineOutput, "src/viewer.js")))
  const files = filesFixture()
  const results = {}
  const minimumHitRatios = new Map([
    ["scrolling", 0.95],
    ["returnBrowsing", 0.95],
    ["treeNavigation", 0.95],
  ])

  for (const [name, operation] of Object.entries(scenarios)) {
    const before = measureScenario(baseline, files, operation)
    const after = measureScenario(current, files, operation)
    assert.equal(after.outputSequenceHash, before.outputSequenceHash, `${name} changed rendered output`)
    assert(
      after.scenarioMilliseconds.p50 <= before.scenarioMilliseconds.p50 * 1.2,
      `${name} median scenario time regressed by more than 20%`,
    )
    assert(
      after.frameMilliseconds.p95 <= before.frameMilliseconds.p95 * 1.5 + 0.1,
      `${name} per-frame p95 regressed by more than 50%`,
    )
    const minimumHitRatio = minimumHitRatios.get(name)
    if (minimumHitRatio !== undefined) {
      assert((after.cacheHitRatio ?? 0) >= minimumHitRatio, `${name} cache hit ratio fell below ${minimumHitRatio}`)
    }
    results[name] = { baseline: before, current: after, outputIdentical: true }
  }

  const memory = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--expose-gc",
        join(root, "benchmarks/render-memory-child.mjs"),
        join(currentOutput, "src/viewer-render-cache.js"),
      ],
      { cwd: root, encoding: "utf8" },
    ),
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        samples,
        rendersPerScenario,
        frameSamplesPerScenario: samples * rendersPerScenario,
        fixture: { files: files.length, largestFileLines: files[0]?.lines.length ?? 0, includesUnicode: true },
        comparison: "current worktree versus pinned HEAD",
        memory,
        results,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
