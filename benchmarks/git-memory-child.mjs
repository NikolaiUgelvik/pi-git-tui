import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [compiledRoot, repositoryPath, operation] = process.argv.slice(2)
if (!compiledRoot || !repositoryPath || !operation) {
  throw new Error("usage: git-memory-child.mjs <compiled-root> <repository> <working|commit>")
}

const activePids = new Set()
let gitProcesses = 0
let peakProcessTreeRssBytes = 0
const supported = process.platform === "linux"

function rssBytes(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8")
    const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status)
    return match ? Number(match[1]) * 1024 : 0
  } catch {
    return 0
  }
}

function descendantPids(pid, seen = new Set()) {
  if (seen.has(pid)) return seen
  seen.add(pid)
  try {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
    for (const child of children) descendantPids(child, seen)
  } catch {
    // A short-lived child may exit between discovery and sampling.
  }
  return seen
}

function sampleRss() {
  if (!supported) return
  const pids = descendantPids(process.pid)
  const rss = [...pids].reduce((total, pid) => total + rssBytes(pid), 0)
  peakProcessTreeRssBytes = Math.max(peakProcessTreeRssBytes, rss)
}

const pi = {
  exec(command, args, options = {}) {
    gitProcesses++
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] })
      if (child.pid) activePids.add(child.pid)
      const stdout = []
      const stderr = []
      let killed = false
      let timer
      const abort = () => {
        killed = true
        child.kill("SIGTERM")
      }
      child.stdout.on("data", (chunk) => {
        stdout.push(chunk)
        sampleRss()
      })
      child.stderr.on("data", (chunk) => {
        stderr.push(chunk)
        sampleRss()
      })
      child.on("error", reject)
      child.on("close", (code) => {
        sampleRss()
        if (child.pid) activePids.delete(child.pid)
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener("abort", abort)
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          code: code ?? (killed ? 1 : 0),
          killed,
        })
      })
      if (options.timeout) timer = setTimeout(abort, options.timeout)
      options.signal?.addEventListener("abort", abort, { once: true })
      sampleRss()
    })
  },
}

const sampler = setInterval(sampleRss, 1)
sampleRss()
try {
  if (operation === "working") {
    const { loadWorkingTreeDiff } = await import(pathToFileURL(join(compiledRoot, "src/git-diff-service.js")))
    await loadWorkingTreeDiff(pi, { cwd: repositoryPath, signal: new AbortController().signal })
  } else if (operation === "commit") {
    const { collectCommitDiffInput } = await import(pathToFileURL(join(compiledRoot, "src/commit-diff-input.js")))
    await collectCommitDiffInput(pi, repositoryPath)
  } else {
    throw new Error(`unsupported operation: ${operation}`)
  }
} finally {
  clearInterval(sampler)
  sampleRss()
}

if (supported) assert(peakProcessTreeRssBytes <= 256 * 1024 * 1024, "process-tree RSS exceeded 256 MiB")
process.stdout.write(
  `${JSON.stringify({
    supported,
    scope: supported
      ? "fresh extension process and complete descendant tree sampled from /proc"
      : "unsupported platform",
    peakProcessTreeRssBytes: supported ? peakProcessTreeRssBytes : null,
    gitProcesses,
  })}\n`,
)
