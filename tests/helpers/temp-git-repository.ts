import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const execFileAsync = promisify(execFile)

export interface TemporaryGitRepository {
  path: string
  cleanup: () => Promise<void>
}

export interface TrackedGitCall {
  args: string[]
  cwd: string | undefined
  signal: AbortSignal | undefined
  timeout: number | undefined
  startedWithAbortedSignal: boolean
}

export async function runFixtureGit(cwd: string, args: readonly string[]): Promise<string> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Pi Git Tests",
    GIT_AUTHOR_EMAIL: "pi-git@example.invalid",
    GIT_COMMITTER_NAME: "Pi Git Tests",
    GIT_COMMITTER_EMAIL: "pi-git@example.invalid",
  }
  delete environment.GIT_DIR
  delete environment.GIT_INDEX_FILE
  delete environment.GIT_WORK_TREE

  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: environment,
  })
  return stdout
}

export async function writeRepoFile(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

export async function stageUniqueFiles(root: string, count: number, prefix = "bounded"): Promise<string[]> {
  const paths = Array.from({ length: count }, (_, index) => `${prefix}-${index}.txt`)
  await Promise.all(paths.map((path, index) => writeRepoFile(root, path, `unique-${index}\n`)))
  await runFixtureGit(root, ["add", ...paths])
  return paths
}

export async function prepareCopyAndSourceChanges(root: string): Promise<void> {
  await writeRepoFile(root, "source.txt", "shared source\n")
  await runFixtureGit(root, ["add", "source.txt"])
  await runFixtureGit(root, ["commit", "-m", "add copy source"])
  await runFixtureGit(root, ["config", "diff.renames", "copies"])
  await runFixtureGit(root, ["config", "status.renames", "copies"])
  await writeRepoFile(root, "copy.txt", "shared source\n")
  await writeRepoFile(root, "source.txt", "shared source\nchanged\n")
  await runFixtureGit(root, ["add", "copy.txt", "source.txt"])
}

export async function createTempGitRepository(
  initialCommit = true,
  objectFormat?: "sha256",
): Promise<TemporaryGitRepository> {
  const path = await mkdtemp(join(tmpdir(), "pi-git-status-"))
  try {
    await runFixtureGit(path, ["init", "-b", "main", ...(objectFormat ? [`--object-format=${objectFormat}`] : [])])
  } catch (error) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
  await runFixtureGit(path, ["config", "user.name", "Pi Git Tests"])
  await runFixtureGit(path, ["config", "user.email", "pi-git@example.invalid"])
  if (initialCommit) {
    await writeRepoFile(path, "tracked.txt", "initial\n")
    await runFixtureGit(path, ["add", "tracked.txt"])
    await runFixtureGit(path, ["commit", "-m", "initial"])
  }
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) }
}

function completedGitResult(
  error: (Error & { code?: string | number | null }) | null,
  stdout: string,
  stderr: string,
  killed: boolean,
): { stdout: string; stderr: string; code: number; killed: boolean } {
  if (error && typeof error.code !== "number" && !killed) throw error
  const code = typeof error?.code === "number" ? error.code : killed ? 1 : 0
  return { stdout, stderr, code, killed }
}

export function createTrackingGitPi(): {
  pi: ExtensionAPI
  calls: TrackedGitCall[]
  peakActive: () => number
} {
  const calls: TrackedGitCall[] = []
  let active = 0
  let peak = 0
  const pi = {
    exec: (command: string, args: string[], options?: { cwd?: string; signal?: AbortSignal; timeout?: number }) => {
      if (command !== "git") {
        return Promise.reject(new Error(`Unexpected command: ${command}`))
      }
      calls.push({
        args: [...args],
        cwd: options?.cwd,
        signal: options?.signal,
        timeout: options?.timeout,
        startedWithAbortedSignal: options?.signal?.aborted ?? false,
      })
      active++
      peak = Math.max(peak, active)
      return new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve, reject) => {
        let killed = false
        let settled = false
        let timer: NodeJS.Timeout | undefined
        const finish = () => {
          if (settled) return false
          settled = true
          active--
          if (timer) clearTimeout(timer)
          options?.signal?.removeEventListener("abort", abort)
          return true
        }
        const child = execFile(
          "git",
          args,
          { cwd: options?.cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (!finish()) return
            try {
              resolve(completedGitResult(error, stdout, stderr, killed))
            } catch (completionError) {
              reject(completionError)
            }
          },
        )
        const abort = () => {
          killed = true
          child.kill()
        }
        if (options?.timeout) {
          timer = setTimeout(abort, options.timeout)
        }
        options?.signal?.addEventListener("abort", abort, { once: true })
      })
    },
  } as unknown as ExtensionAPI
  return { pi, calls, peakActive: () => peak }
}
