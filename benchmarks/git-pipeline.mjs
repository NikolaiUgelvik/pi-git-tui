import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const iterationsFlag = process.argv.indexOf("--iterations")
const iterations = iterationsFlag < 0 ? 3 : Number(process.argv[iterationsFlag + 1])
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error("--iterations must be a positive integer")
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.min(sorted.length - 1, rank)] ?? 0
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
}

function summarize(values) {
  return {
    median: median(values),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function child(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    processHandle.stdout.on("data", (chunk) => stdout.push(chunk))
    processHandle.stderr.on("data", (chunk) => stderr.push(chunk))
    processHandle.on("error", reject)
    processHandle.on("close", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 1,
        signal,
      }
      if (options.accepted?.includes(result.code)) resolve(result)
      else reject(new Error(`${command} ${args.join(" ")} failed (${result.code}): ${result.stderr}`))
    })
  })
}

async function compile(output) {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc")
  await child(
    process.execPath,
    [tsc, "--project", join(root, "tsconfig.json"), "--noEmit", "false", "--outDir", output, "--rootDir", root],
    { cwd: root, accepted: [0] },
  )
  await symlink(
    join(root, "node_modules"),
    join(output, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
}

async function git(cwd, args) {
  return child("git", args, {
    cwd,
    accepted: [0],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Pi Git TUI Benchmark",
      GIT_AUTHOR_EMAIL: "pi-git-tui@example.invalid",
      GIT_COMMITTER_NAME: "Pi Git TUI Benchmark",
      GIT_COMMITTER_EMAIL: "pi-git-tui@example.invalid",
    },
  })
}

async function initialRepository(workspace, name) {
  const path = join(workspace, name)
  await mkdir(path)
  await git(path, ["init", "-q", "-b", "main"])
  return path
}

async function repository(workspace, name) {
  const path = await initialRepository(workspace, name)
  await writeFile(join(path, "tracked.txt"), "initial\n")
  await git(path, ["add", "tracked.txt"])
  await git(path, ["commit", "-qm", "initial"])
  return path
}

async function writeFiles(repositoryPath, count, bytes, prefix = "untracked") {
  const directory = join(repositoryPath, prefix)
  await mkdir(directory, { recursive: true })
  const body = bytes <= 16 ? "x".repeat(bytes) : Buffer.alloc(bytes, 120)
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeFile(join(directory, `file-${String(index).padStart(3, "0")}.txt`), body),
    ),
  )
}

async function writeUniqueFiles(repositoryPath, count, prefix) {
  const directory = join(repositoryPath, prefix)
  await mkdir(directory, { recursive: true })
  const indexes = Array.from({ length: count }, (_, index) => index)
  for (let offset = 0; offset < indexes.length; offset += 200) {
    await Promise.all(
      indexes
        .slice(offset, offset + 200)
        .map((index) => writeFile(join(directory, `file-${String(index).padStart(5, "0")}.txt`), `unique-${index}\n`)),
    )
  }
}

function trackingPi(onCall = () => {}) {
  const calls = []
  let active = 0
  let peak = 0
  let maximumStdoutBytes = 0
  return {
    calls,
    peak: () => peak,
    maximumStdoutBytes: () => maximumStdoutBytes,
    pi: {
      exec: (command, args, options = {}) => {
        const startedAborted = options.signal?.aborted ?? false
        const call = { command, args: [...args], startedAborted, startedAt: performance.now() }
        calls.push(call)
        onCall(call)
        active++
        peak = Math.max(peak, active)
        return new Promise((resolve, reject) => {
          const handle = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] })
          const stdout = []
          const stderr = []
          let killed = false
          let settled = false
          let timeout
          const abort = () => {
            killed = true
            handle.kill("SIGTERM")
          }
          const finish = () => {
            if (settled) return false
            settled = true
            active--
            if (timeout) clearTimeout(timeout)
            options.signal?.removeEventListener("abort", abort)
            return true
          }
          handle.stdout.on("data", (chunk) => stdout.push(chunk))
          handle.stderr.on("data", (chunk) => stderr.push(chunk))
          handle.on("error", (error) => {
            if (finish()) reject(error)
          })
          handle.on("close", (code) => {
            if (!finish()) return
            const stdoutText = Buffer.concat(stdout).toString("utf8")
            maximumStdoutBytes = Math.max(maximumStdoutBytes, Buffer.byteLength(stdoutText))
            resolve({
              stdout: stdoutText,
              stderr: Buffer.concat(stderr).toString("utf8"),
              code: code ?? (killed ? 1 : 0),
              killed,
            })
          })
          if (options.timeout) timeout = setTimeout(abort, options.timeout)
          options.signal?.addEventListener("abort", abort, { once: true })
        })
      },
    },
  }
}

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function orderingHash(paths) {
  return contentHash(paths.join("\0"))
}

async function measureScenario(name, repositoryPath, operation) {
  const wall = []
  const gitProcesses = []
  const peaks = []
  const callsAfterCancellation = []
  const returnedStdout = []
  const parentRssGrowth = []
  const heapGrowth = []
  let final = {}

  for (let iteration = 0; iteration < iterations; iteration++) {
    const tracker = trackingPi()
    const before = process.memoryUsage()
    let peakRss = before.rss
    let peakHeap = before.heapUsed
    const sampler = setInterval(() => {
      const memory = process.memoryUsage()
      peakRss = Math.max(peakRss, memory.rss)
      peakHeap = Math.max(peakHeap, memory.heapUsed)
    }, 2)
    const started = performance.now()
    const result = await operation(tracker.pi, repositoryPath)
    wall.push(performance.now() - started)
    clearInterval(sampler)

    gitProcesses.push(tracker.calls.length)
    peaks.push(tracker.peak())
    callsAfterCancellation.push(tracker.calls.filter((call) => call.startedAborted).length)
    returnedStdout.push(tracker.maximumStdoutBytes())
    parentRssGrowth.push(peakRss - before.rss)
    heapGrowth.push(peakHeap - before.heapUsed)
    final = result
  }

  return {
    name,
    iterations,
    wallMs: summarize(wall),
    gitProcesses: summarize(gitProcesses),
    peakConcurrentChildren: Math.max(...peaks),
    callsStartedAfterCancellation: Math.max(...callsAfterCancellation),
    maximumReturnedStdoutBytes: Math.max(...returnedStdout),
    parentPeakRssGrowthBytes: Math.max(...parentRssGrowth),
    parentMemoryScope: "benchmark parent only; excludes Git children and is supplementary",
    peakHeapGrowthBytes: Math.max(...heapGrowth),
    ...final,
  }
}

async function measureCancellation(name, repositoryPath, loadWorkingTreeDiff, createTrigger) {
  const wall = []
  const processCounts = []
  const peaks = []
  const postAbortCalls = []
  let allAborted = true
  for (let iteration = 0; iteration < iterations; iteration++) {
    const controller = new AbortController()
    let abortedAt
    const abort = () => {
      if (controller.signal.aborted) return
      abortedAt = performance.now()
      controller.abort()
    }
    const trigger = createTrigger()
    const tracker = trackingPi((call) => trigger.onCall(call, abort))
    if (trigger.preAbort) abort()
    const started = performance.now()
    try {
      await loadWorkingTreeDiff(tracker.pi, { cwd: repositoryPath, signal: controller.signal })
      allAborted = false
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "GitAbortError") throw error
    }
    wall.push(performance.now() - started)
    processCounts.push(tracker.calls.length)
    peaks.push(tracker.peak())
    postAbortCalls.push(abortedAt === undefined ? 0 : tracker.calls.filter((call) => call.startedAt > abortedAt).length)
  }
  return {
    name,
    iterations,
    wallMs: summarize(wall),
    gitProcesses: summarize(processCounts),
    peakConcurrentChildren: Math.max(...peaks),
    callsStartedAfterCancellation: Math.max(...postAbortCalls),
    aborted: allAborted,
  }
}

function preAbortTrigger() {
  return { preAbort: true, onCall: () => {} }
}

function statusAbortTrigger() {
  return {
    preAbort: false,
    onCall: (call, abort) => {
      if (call.args[0] === "status") queueMicrotask(abort)
    },
  }
}

function untrackedAbortTrigger() {
  let started = 0
  return {
    preAbort: false,
    onCall: (call, abort) => {
      if (call.args.includes("--no-index") && ++started === 4) queueMicrotask(abort)
    },
  }
}

const workspace = await mkdtemp(join(tmpdir(), "pi-git-tui-pipeline-benchmark-"))
try {
  const output = join(workspace, "compiled")
  await compile(output)
  const { loadWorkingTreeDiff } = await import(pathToFileURL(join(output, "src", "git-diff-service.js")))
  const { collectCommitDiffInput } = await import(pathToFileURL(join(output, "src", "commit-diff-input.js")))
  const scenarios = []
  const memoryCases = []

  for (const count of [0, 10, 50, 500]) {
    const repo = await repository(workspace, `untracked-${count}`)
    await writeFiles(repo, count, 8)
    memoryCases.push([`untracked-${count}`, repo, "working"])
    scenarios.push(
      await measureScenario(`untracked-${count}`, repo, async (pi, cwd) => {
        const document = await loadWorkingTreeDiff(pi, { cwd, signal: new AbortController().signal })
        return {
          omittedFiles: document.omittedFileCount,
          capturedPatchBytes: document.capturedPatchBytes,
          capturedPatchLines: document.capturedPatchLines,
          patchHash: contentHash(document.raw),
          orderingHash: orderingHash(document.files.map((file) => file.path)),
        }
      }),
    )
  }

  const cancellationRepo = await repository(workspace, "cancellation-50")
  await writeFiles(cancellationRepo, 50, 8)
  const cancellationScenarios = [
    await measureCancellation("cancel-before-root", cancellationRepo, loadWorkingTreeDiff, preAbortTrigger),
    await measureCancellation("cancel-during-status", cancellationRepo, loadWorkingTreeDiff, statusAbortTrigger),
    await measureCancellation("cancel-during-untracked", cancellationRepo, loadWorkingTreeDiff, untrackedAbortTrigger),
  ]
  scenarios.push(...cancellationScenarios)

  const largeUntracked = await repository(workspace, "untracked-40x200k")
  await writeFiles(largeUntracked, 40, 200 * 1024)
  memoryCases.push(["untracked-40x200k", largeUntracked, "working"])
  scenarios.push(
    await measureScenario("untracked-40x200k", largeUntracked, async (pi, cwd) => {
      const document = await loadWorkingTreeDiff(pi, { cwd, signal: new AbortController().signal })
      return {
        omittedFiles: document.omittedFileCount,
        capturedPatchBytes: document.capturedPatchBytes,
        patchHash: contentHash(document.raw),
        orderingHash: orderingHash(document.files.map((file) => file.path)),
      }
    }),
  )

  for (const mebibytes of [1, 10, 25]) {
    const repo = await repository(workspace, `tracked-${mebibytes}m`)
    await writeFile(join(repo, "tracked.txt"), Buffer.alloc(mebibytes * 1024 * 1024, 116))
    memoryCases.push([`tracked-${mebibytes}MiB`, repo, "working"])
    scenarios.push(
      await measureScenario(`tracked-${mebibytes}MiB`, repo, async (pi, cwd) => {
        const document = await loadWorkingTreeDiff(pi, { cwd, signal: new AbortController().signal })
        return {
          omittedFiles: document.omittedFileCount,
          capturedPatchBytes: document.capturedPatchBytes,
          patchHash: contentHash(document.raw),
          orderingHash: orderingHash(document.files.map((file) => file.path)),
        }
      }),
    )
  }

  for (const count of [600, 10_000]) {
    const initialMany = await initialRepository(workspace, `initial-${count}`)
    await writeUniqueFiles(initialMany, count, "staged")
    await git(initialMany, ["add", "--all"])
    memoryCases.push([`initial-staged-${count}`, initialMany, "working"])
    scenarios.push(
      await measureScenario(`initial-staged-${count}`, initialMany, async (pi, cwd) => {
        const document = await loadWorkingTreeDiff(pi, { cwd, signal: new AbortController().signal })
        return {
          includedFiles: document.files.length - document.omittedFileCount,
          omittedFiles: document.omittedFileCount,
          capturedPatchBytes: document.capturedPatchBytes,
          orderingHash: orderingHash(document.files.map((file) => file.path)),
        }
      }),
    )

    const stagedMany = await repository(workspace, `staged-${count}`)
    await writeUniqueFiles(stagedMany, count, "staged")
    await git(stagedMany, ["add", "--all"])
    memoryCases.push([`commit-staged-${count}`, stagedMany, "commit"])
    scenarios.push(
      await measureScenario(`commit-staged-${count}`, stagedMany, async (pi, cwd) => {
        const input = await collectCommitDiffInput(pi, cwd)
        return {
          includedFiles: input.includedFiles,
          omittedFiles: input.omittedFiles,
          capturedPatchChars: input.capturedPatchChars,
          promptInputChars: input.text.length,
        }
      }),
    )
  }

  const staged = await repository(workspace, "staged-8m")
  await writeFile(join(staged, "staged-large.txt"), Buffer.alloc(8 * 1024 * 1024, 115))
  await git(staged, ["add", "staged-large.txt"])
  memoryCases.push(["staged-8MiB", staged, "commit"])
  scenarios.push(
    await measureScenario("staged-8MiB", staged, async (pi, cwd) => {
      const input = await collectCommitDiffInput(pi, cwd)
      return {
        includedFiles: input.includedFiles,
        omittedFiles: input.omittedFiles,
        capturedPatchChars: input.capturedPatchChars,
        promptInputChars: input.text.length,
        promptInputHash: contentHash(input.text),
      }
    }),
  )

  const memoryMeasurements = memoryCases.map(([name, repositoryPath, operation]) => ({
    name,
    ...JSON.parse(
      execFileSync(
        process.execPath,
        [join(root, "benchmarks/git-memory-child.mjs"), output, repositoryPath, operation],
        { cwd: root, encoding: "utf8" },
      ),
    ),
  }))

  for (const count of [600, 10_000]) {
    const initialBound = scenarios.find((scenario) => scenario.name === `initial-staged-${count}`)
    const commitBound = scenarios.find((scenario) => scenario.name === `commit-staged-${count}`)
    assert(initialBound && initialBound.gitProcesses.max <= 520, `initial ${count}-file process bound regressed`)
    assert(commitBound && commitBound.gitProcesses.max <= 60, `commit ${count}-file process bound regressed`)
    assert(initialBound.wallMs.max < 30_000, `initial ${count}-file capture exceeded 30 seconds`)
    assert(commitBound.wallMs.max < 30_000, `commit ${count}-file capture exceeded 30 seconds`)
  }
  const cancellationProcessCeilings = new Map([
    ["cancel-before-root", 0],
    ["cancel-during-status", 2],
    ["cancel-during-untracked", 8],
  ])
  for (const scenario of cancellationScenarios) {
    assert.equal(scenario.aborted, true, `${scenario.name} did not cancel`)
    assert.equal(scenario.callsStartedAfterCancellation, 0, `${scenario.name} started work after cancellation`)
    assert(
      scenario.gitProcesses.max <= (cancellationProcessCeilings.get(scenario.name) ?? 0),
      `${scenario.name} exceeded its process ceiling`,
    )
  }

  process.stdout.write(
    `${JSON.stringify({ generatedAt: new Date().toISOString(), memoryMeasurements, scenarios }, null, 2)}\n`,
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}
