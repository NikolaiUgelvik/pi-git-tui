import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs"
import { cpus, platform, release, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspace = mkdtempSync(join(tmpdir(), "pi-git-tui-developer-loop-"))
const sampleCount = 20

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0
}

function summarize(values) {
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function copyFixture() {
  for (const directory of ["extensions", "scripts", "src", "tests"]) {
    cpSync(join(root, directory), join(workspace, directory), { recursive: true })
  }
  for (const file of [
    ".gitattributes",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "tsconfig.test.json",
    "tsconfig.typecheck.json",
  ]) {
    cpSync(join(root, file), join(workspace, file))
  }
  symlinkSync(
    join(root, "node_modules"),
    join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  mkdirSync(join(workspace, ".tmp-tests"), { recursive: true })
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    throw new Error([`${command} failed (${result.signal ?? result.status})`, result.stdout, result.stderr].join("\n"))
  }
}

function semanticEdit(original) {
  const modified = original.replace("if (bytes < 1024)", "if (bytes < 1025)")
  if (modified === original) throw new Error("developer-loop semantic edit target was not found")
  return modified
}

function measureCommand(path, original, modified, command, args) {
  run(command, args)
  const values = []
  for (let sample = 0; sample < sampleCount; sample++) {
    writeFileSync(path, modified)
    const started = performance.now()
    run(command, args)
    values.push(performance.now() - started)
    writeFileSync(path, original)
  }
  return summarize(values)
}

function outputMonitor(child) {
  let output = ""
  const append = (chunk) => {
    output += chunk.toString()
  }
  child.stdout.on("data", append)
  child.stderr.on("data", append)
  return {
    offset: () => output.length,
    waitFor(pattern, from = 0, timeoutMs = 15_000) {
      return new Promise((resolvePromise, rejectPromise) => {
        const started = performance.now()
        const inspect = () => {
          if (!pattern.test(output.slice(from))) return
          cleanup()
          resolvePromise(performance.now() - started)
        }
        const fail = () => {
          cleanup()
          rejectPromise(new Error(`watch output timed out waiting for ${pattern}:\n${output.slice(from)}`))
        }
        const cleanup = () => {
          clearTimeout(timer)
          child.stdout.off("data", inspect)
          child.stderr.off("data", inspect)
        }
        const timer = setTimeout(fail, timeoutMs)
        child.stdout.on("data", inspect)
        child.stderr.on("data", inspect)
        inspect()
      })
    },
    text: () => output,
  }
}

async function stopWatcher(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      resolvePromise()
    }, 2_000)
    child.once("close", () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

async function measureWatch(path, original, modified, args, readyPattern, resultPatterns) {
  const child = spawn(process.execPath, args, { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] })
  const monitor = outputMonitor(child)
  const values = Object.fromEntries(Object.keys(resultPatterns).map((name) => [name, []]))
  try {
    await monitor.waitFor(readyPattern)
    for (let sample = 0; sample < sampleCount; sample++) {
      const offset = monitor.offset()
      writeFileSync(path, sample % 2 === 0 ? modified : original)
      const measurements = await Promise.all(
        Object.values(resultPatterns).map((pattern) => monitor.waitFor(pattern, offset)),
      )
      Object.keys(resultPatterns).forEach((name, index) => {
        values[name].push(measurements[index])
      })
    }
    return Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, summarize(samples)]))
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nFull watch output:\n${monitor.text()}`)
  } finally {
    writeFileSync(path, original)
    await stopWatcher(child)
  }
}

function environmentMetadata() {
  const typescript = JSON.parse(readFileSync(join(root, "node_modules/typescript/package.json"), "utf8"))
  const cpu = cpus()[0]
  return {
    node: process.version,
    typescript: typescript.version,
    os: `${platform()} ${release()}`,
    cpu: cpu ? { model: cpu.model, logicalCores: cpus().length } : undefined,
    filesystemType: String(statfsSync(workspace).type),
    temporaryDirectory: tmpdir(),
  }
}

function assertOptInThresholds(results) {
  if (!process.argv.includes("--assert")) return
  const measurements = [
    results.commandTypecheck,
    results.commandTest,
    results.watchTypecheck.compiler,
    results.watchTest.compiler,
    results.watchTest.test,
  ]
  for (const measurement of measurements) assert(measurement.p95 < 10_000, "edit-to-feedback p95 exceeded 10 seconds")
}

copyFixture()
try {
  const sourcePath = join(workspace, "src/diff-omission.ts")
  const original = readFileSync(sourcePath, "utf8")
  const modified = semanticEdit(original)
  const tsc = join(root, "node_modules/typescript/bin/tsc")
  const results = {
    commandTypecheck: measureCommand(sourcePath, original, modified, process.execPath, [
      tsc,
      "-p",
      "tsconfig.typecheck.json",
    ]),
    commandTest: measureCommand(sourcePath, original, modified, process.execPath, [
      "scripts/test.mjs",
      "--file",
      "tests/diff-omission.test.ts",
    ]),
    watchTypecheck: await measureWatch(
      sourcePath,
      original,
      modified,
      [tsc, "-p", "tsconfig.typecheck.json", "--watch", "--preserveWatchOutput"],
      /Found 0 errors\. Watching for file changes\./u,
      { compiler: /Found 0 errors\. Watching for file changes\./u },
    ),
    watchTest: await measureWatch(
      sourcePath,
      original,
      modified,
      ["scripts/test.mjs", "--watch", "tests/diff-omission.test.ts"],
      /pass \d+/u,
      {
        compiler: /Found 0 errors\. Watching for file changes\./u,
        test: /pass \d+/u,
      },
    ),
  }
  assertOptInThresholds(results)
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        edit: "changes the byte-formatting threshold from 1024 to 1025 in an isolated copy",
        environment: environmentMetadata(),
        results,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
