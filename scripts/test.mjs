import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = resolve(root, ".tmp-tests")
const sourceTestDirectory = resolve(root, "tests")
const testConfigPath = resolve(root, "tsconfig.test.json")
const tscPath = resolve(root, "node_modules/typescript/bin/tsc")

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`${command} was terminated by ${result.signal}`)
  return result.status ?? 1
}

function cleanTestOutput() {
  rmSync(outputDirectory, { recursive: true, force: true })
}

function compileTests() {
  return run(process.execPath, [tscPath, "-p", testConfigPath])
}

function collectTestSources(directory = sourceTestDirectory) {
  const sources = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      sources.push(...collectTestSources(path))
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      sources.push(path)
    }
  }
  return sources.sort()
}

function isInside(directory, path) {
  const relativePath = relative(directory, path)
  return (
    relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
  )
}

function resolveRequestedTests(requestedPaths) {
  if (requestedPaths.length === 0) {
    throw new Error("Pass at least one test path, for example: npm run test:file -- tests/diff-parser.test.ts")
  }

  const sources = requestedPaths.map((requestedPath) => {
    const source = resolve(root, requestedPath)
    if (!isInside(sourceTestDirectory, source) || !source.endsWith(".test.ts")) {
      throw new Error(`Test path must name a tests/**/*.test.ts file: ${requestedPath}`)
    }
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(`Test file does not exist: ${requestedPath}`)
    }
    return source
  })
  return [...new Set(sources)].sort()
}

function emittedTestPath(source) {
  const relativeSource = relative(root, source)
  const emitted = resolve(outputDirectory, relativeSource.replace(/\.ts$/, ".js"))
  if (!existsSync(emitted)) throw new Error(`TypeScript did not emit ${relative(root, emitted)}`)
  return emitted
}

function emittedTestPaths(sources) {
  if (sources.length === 0) throw new Error("No tests/**/*.test.ts files were found")
  return sources.map(emittedTestPath)
}

function runTests(sources) {
  const compileStatus = compileTests()
  if (compileStatus !== 0) return compileStatus
  return run(process.execPath, ["--test", ...emittedTestPaths(sources)])
}

function runFullSuite(extraArguments) {
  if (extraArguments.length !== 0) {
    throw new Error("npm test always runs the full suite; use npm run test:file -- <path> for targeted tests")
  }

  cleanTestOutput()
  try {
    return runTests(collectTestSources())
  } finally {
    cleanTestOutput()
  }
}

function stopChild(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
}

function watchTests(sources) {
  const compileStatus = compileTests()
  if (compileStatus !== 0) return Promise.resolve(compileStatus)

  const testFiles = emittedTestPaths(sources)
  const compiler = spawn(process.execPath, [tscPath, "-p", testConfigPath, "--watch", "--preserveWatchOutput"], {
    cwd: root,
    stdio: "inherit",
  })
  const tests = spawn(process.execPath, ["--test", "--watch", ...testFiles], { cwd: root, stdio: "inherit" })
  const children = [compiler, tests]

  return new Promise((resolvePromise, rejectPromise) => {
    let finished = false

    function cleanup() {
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", terminate)
      for (const child of children) {
        child.removeListener("error", fail)
        child.removeListener("exit", childExited)
      }
    }

    function finish(status) {
      if (finished) return
      finished = true
      for (const child of children) stopChild(child)
      cleanup()
      resolvePromise(status)
    }

    function fail(error) {
      if (finished) return
      finished = true
      for (const child of children) stopChild(child)
      cleanup()
      rejectPromise(error)
    }

    function childExited(code, signal) {
      if (signal === "SIGTERM" || signal === "SIGINT") {
        finish(0)
      } else {
        finish(code ?? 1)
      }
    }

    function interrupt() {
      finish(130)
    }

    function terminate() {
      finish(143)
    }

    process.once("SIGINT", interrupt)
    process.once("SIGTERM", terminate)
    for (const child of children) {
      child.once("error", fail)
      child.once("exit", childExited)
    }
  })
}

async function main() {
  const [mode, ...arguments_] = process.argv.slice(2)
  if (mode === "--all") return runFullSuite(arguments_)
  if (mode === "--file") return runTests(resolveRequestedTests(arguments_))
  if (mode === "--watch") {
    const sources = arguments_.length === 0 ? collectTestSources() : resolveRequestedTests(arguments_)
    return watchTests(sources)
  }
  throw new Error("Expected one of --all, --file, or --watch")
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`pi-git test runner failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
