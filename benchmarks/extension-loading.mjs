import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const childPath = resolve(root, "benchmarks/extension-load-child.mjs")
const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-git-extension-load-"))
const agentDirectory = join(temporaryRoot, "agent")
mkdirSync(agentDirectory)

function parseIterations() {
  const index = process.argv.indexOf("--iterations")
  const rawValue = index >= 0 ? process.argv[index + 1] : undefined
  const iterations = rawValue === undefined ? 10 : Number.parseInt(rawValue, 10)
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("--iterations must be a positive integer")
  }
  return iterations
}

function successfulOutput(result, label) {
  if (result.error) throw result.error
  if (!result.signal && result.status === 0) return result.stdout
  const details = [
    `${label} failed (${result.signal ?? result.status})`,
    result.stdout.trim(),
    result.stderr.trim(),
  ].filter(Boolean)
  throw new Error(details.join("\n"))
}

function sample(entryPath) {
  const startedAt = performance.now()
  const result = spawnSync(process.execPath, [childPath, entryPath, root, agentDirectory], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  const wallMs = performance.now() - startedAt
  const payload = JSON.parse(successfulOutput(result, "extension discovery").trim())
  if (typeof payload.loadMs !== "number") throw new Error("load child returned an invalid measurement")
  return { loadMs: payload.loadMs, wallMs }
}

function samplePiReadiness(entryPath) {
  const cliPath = resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js")
  const startedAt = performance.now()
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--no-extensions",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-tools",
      "--extension",
      entryPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      input: '{"id":"ready","type":"get_commands"}\n',
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: "1" },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const wallMs = performance.now() - startedAt
  const response = successfulOutput(result, "Pi readiness")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) => event.id === "ready")
  const commands = response?.success ? response.data?.commands : undefined
  if (!Array.isArray(commands)) throw new Error("Pi readiness returned no command list")
  if (!commands.some((command) => command.name === "diff")) throw new Error("Pi became ready without /diff")
  return wallMs
}

function measuredSample(entryPath) {
  return { ...sample(entryPath), piReadyMs: samplePiReadiness(entryPath) }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index]
}

function summarize(samples, key) {
  const values = samples.map((sample) => sample[key])
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function format(summary) {
  return `median ${summary.median.toFixed(1)} ms, p95 ${summary.p95.toFixed(1)} ms, range ${summary.min.toFixed(1)}-${summary.max.toFixed(1)} ms`
}

try {
  const iterations = parseIterations()
  const targets = {
    source: resolve(root, "extensions/diff.ts"),
    built: resolve(root, "dist/extensions/diff.js"),
  }

  measuredSample(targets.source)
  measuredSample(targets.built)

  const samples = { source: [], built: [] }
  for (let index = 0; index < iterations; index++) {
    const order = index % 2 === 0 ? ["source", "built"] : ["built", "source"]
    for (const target of order) samples[target].push(measuredSample(targets[target]))
  }

  const sourceLoad = summarize(samples.source, "loadMs")
  const builtLoad = summarize(samples.built, "loadMs")
  const sourceWall = summarize(samples.source, "wallMs")
  const builtWall = summarize(samples.built, "wallMs")
  const sourcePiReady = summarize(samples.source, "piReadyMs")
  const builtPiReady = summarize(samples.built, "piReadyMs")
  const loadReduction = ((sourceLoad.median - builtLoad.median) / sourceLoad.median) * 100
  const wallReduction = ((sourceWall.median - builtWall.median) / sourceWall.median) * 100
  const piReadyReduction = ((sourcePiReady.median - builtPiReady.median) / sourcePiReady.median) * 100

  console.log(`Fresh-process extension loading (${iterations} measured samples per target; one warm-up discarded)`)
  console.log(
    "Cache scope: every sample starts a new Node process, so process/module caches are cold; filesystem page caches are left warm. No physical-cold claim is made.",
  )
  console.log(`Source TypeScript loader: ${format(sourceLoad)} (child load), ${format(sourceWall)} (discovery wall)`)
  console.log(`Built JavaScript loader: ${format(builtLoad)} (child load), ${format(builtWall)} (discovery wall)`)
  console.log(`Source Pi RPC command readiness: ${format(sourcePiReady)}`)
  console.log(`Built Pi RPC command readiness: ${format(builtPiReady)}`)
  console.log(
    `Median Pi RPC command-readiness reduction: ${piReadyReduction.toFixed(1)}% (full Pi process; excludes interactive TUI readiness)`,
  )
  console.log(`Median extension-discovery process-wall reduction: ${wallReduction.toFixed(1)}%`)
  console.log(`Median extension-loader segment reduction: ${loadReduction.toFixed(1)}%`)
  if (process.argv.includes("--assert")) {
    if (iterations < 20) throw new Error("--assert requires at least 20 measured samples per target")
    if (builtLoad.median > sourceLoad.median * 0.5) {
      throw new Error("built extension-loader median exceeded 50% of the source median")
    }
    if (builtWall.median > sourceWall.median * 0.9) {
      throw new Error("built extension-discovery wall median exceeded 90% of the source median")
    }
    if (builtPiReady.median > sourcePiReady.median * 0.95) {
      throw new Error("built Pi RPC readiness median exceeded 95% of the source median")
    }
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
