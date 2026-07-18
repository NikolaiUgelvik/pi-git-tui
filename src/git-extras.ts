import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { diffFileOperationPaths } from "./diff-document.js"
import { withLiteralPaths } from "./git-literal-path.js"
import {
  assertGitSuccess,
  ensureGitRepository,
  type GitCompletedResult,
  GitExitError,
  isUnbornHeadResult,
  probeGit,
  requireGitRepository,
  runGit,
} from "./git-service.js"
import { hasNestedSubmoduleChanges, isSubmoduleState } from "./git-submodule-state.js"
import type { DiffFile } from "./types.js"

export { createAndSwitchBranch, getBranches as listBranches, switchBranch } from "./git-branch-service.js"
export {
  applyStash,
  dropStash,
  getStashes as listStashes,
  popStash,
  stashCurrentChanges,
} from "./git-stash-service.js"
export { listWorktrees, parseWorktreeList } from "./git-worktree-service.js"
export type { WorktreeSummary } from "./types.js"

export async function initializeGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  const existing = await ensureGitRepository(pi, cwd, signal)
  if (existing) return `Already a git repository: ${existing}`
  await runGit(pi, cwd, ["init"], { signal, timeoutClass: "mutation" })
  const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd
  return `Initialized git repository in ${root}`
}

interface DiscardPathClassification {
  head: Set<string>
  index: Set<string>
  untracked: Set<string>
}

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
  const args = ["rev-parse", "--verify", "HEAD"]
  const result = await probeGit(pi, cwd, args, { signal })
  if (result.code === 0) return true
  if (isUnbornHeadResult(result)) return false
  assertGitSuccess(result, args, cwd)
  return true
}

function nullDelimitedPaths(output: string): Set<string> {
  return new Set(output.split("\0").filter(Boolean))
}

function indexEntryPaths(output: string): Set<string> {
  return new Set(
    output.split("\0").flatMap((entry) => {
      const separator = entry.indexOf("\t")
      return separator < 0 ? [] : [entry.slice(separator + 1)]
    }),
  )
}

async function classifyDiscardPaths(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<DiscardPathClassification> {
  const indexResult = await runGit(
    pi,
    root,
    withLiteralPaths(["-c", "core.quotepath=false", "ls-files", "--stage", "-z"], paths),
    { signal },
  )
  const untrackedResult = await runGit(
    pi,
    root,
    withLiteralPaths(["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z"], paths),
    { signal },
  )
  const ignoredResult = await runGit(
    pi,
    root,
    withLiteralPaths(
      ["-c", "core.quotepath=false", "ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
      paths,
    ),
    { signal },
  )

  const head = new Set<string>()
  if (await hasHead(pi, root, signal)) {
    const headResult = await runGit(
      pi,
      root,
      withLiteralPaths(["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", "-z", "HEAD"], paths),
      { signal },
    )
    for (const path of nullDelimitedPaths(headResult.stdout)) head.add(path)
  }
  return {
    head,
    index: indexEntryPaths(indexResult.stdout),
    untracked: new Set([...nullDelimitedPaths(untrackedResult.stdout), ...nullDelimitedPaths(ignoredResult.stdout)]),
  }
}

async function pathExists(root: string, path: string): Promise<boolean> {
  try {
    await lstat(resolve(root, path))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return false
    throw error
  }
}

async function restoreHeadPaths(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  if (paths.length === 0) return
  await runGit(pi, root, withLiteralPaths(["restore", "--source=HEAD", "--staged", "--worktree"], paths), {
    signal,
    timeoutClass: "mutation",
  })
}

async function removeIndexOnlyPaths(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  if (paths.length === 0) return
  await runGit(pi, root, withLiteralPaths(["rm", "--cached", "-r", "-f"], paths), {
    signal,
    timeoutClass: "mutation",
  })
}

async function cleanUntrackedPaths(
  pi: ExtensionAPI,
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  if (paths.length === 0) return
  await runGit(pi, root, withLiteralPaths(["clean", "-f", "-d", "-x"], paths), {
    signal,
    timeoutClass: "mutation",
  })
}

function assertNoDiff(result: GitCompletedResult, args: readonly string[], root: string, kind: string): void {
  if (result.code === 0) return
  if (result.code === 1) {
    throw new GitExitError(
      { ...result, stderr: result.stderr || `${kind} changes remain after discard` },
      args,
      undefined,
      root,
    )
  }
  assertGitSuccess(result, args, [0, 1], root)
}

async function verifyDiscard(
  pi: ExtensionAPI,
  root: string,
  aliases: readonly string[],
  cleanedPaths: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  const stagedArgs = withLiteralPaths(["diff", "--cached", "--quiet"], aliases)
  const workingArgs = withLiteralPaths(["diff", "--quiet"], aliases)
  assertNoDiff(await probeGit(pi, root, stagedArgs, { signal }), stagedArgs, root, "Staged")
  assertNoDiff(await probeGit(pi, root, workingArgs, { signal }), workingArgs, root, "Working-tree")
  for (const path of cleanedPaths) {
    if (await pathExists(root, path)) throw new Error(`Untracked path remains after discard: ${path}`)
  }
}

function assertSubmoduleDiscardIsSafe(file: DiffFile): void {
  if (!isSubmoduleState(file.submodule)) return
  const detail = hasNestedSubmoduleChanges(file.submodule)
    ? "manage nested changes inside the submodule"
    : "update the submodule checkout explicitly"
  throw new Error(`Cannot discard ${file.path}: ${detail}`)
}

export async function discardFileChanges(
  pi: ExtensionAPI,
  cwd: string,
  file: DiffFile,
  signal?: AbortSignal,
): Promise<string> {
  if (file.omission) throw new Error(`Cannot discard ${file.path} because its diff was omitted`)
  assertSubmoduleDiscardIsSafe(file)
  const root = await requireGitRepository(pi, cwd, signal)
  const aliases = diffFileOperationPaths(file)
  if (aliases.length === 0) throw new Error("No selected file path to discard")

  const classification = await classifyDiscardPaths(pi, root, aliases, signal)
  const headPaths = aliases.filter((path) => classification.head.has(path))
  const indexOnlyPaths = aliases.filter((path) => classification.index.has(path) && !classification.head.has(path))
  await restoreHeadPaths(pi, root, headPaths, signal)
  await removeIndexOnlyPaths(pi, root, indexOnlyPaths, signal)

  const cleanablePaths: string[] = []
  for (const path of aliases) {
    if (
      !classification.head.has(path) &&
      (classification.untracked.has(path) || classification.index.has(path) || (await pathExists(root, path)))
    ) {
      cleanablePaths.push(path)
    }
  }
  await cleanUntrackedPaths(pi, root, cleanablePaths, signal)
  await verifyDiscard(pi, root, aliases, cleanablePaths, signal)
  return `Discarded changes in ${file.path}`
}
