import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDiff } from "../src/git-diff-service.js"
import type { DiffDocument, GitCommand } from "../src/types.js"
import { GIT_COMMANDS } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import type { ViewerRenderCacheStats } from "../src/viewer-render-cache.js"
import { createTempGitRepository, createTrackingGitPi, writeRepoFile } from "./helpers/temp-git-repository.js"
import { testViewerOptions } from "./helpers/viewer.js"

interface RawGitResult {
  stdout: string
  stderr: string
  code: number
  killed: boolean
}

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

function context(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext
}

class CommandRefreshViewer extends DiffViewer {
  runCommand(command: GitCommand): Promise<void> {
    return this.runSelectedCommand(command)
  }

  currentDocument(): DiffDocument {
    return this.document
  }

  setScroll(value: number): void {
    this.diffScroll = value
  }

  scroll(): number {
    return this.diffScroll
  }

  visibleError(): string | undefined {
    return this.error
  }

  cacheStats(): ViewerRenderCacheStats {
    return this.renderCacheStats()
  }
}

function createViewer(pi: ExtensionAPI, cwd: string, document: DiffDocument): CommandRefreshViewer {
  return new CommandRefreshViewer(
    pi,
    context(cwd),
    theme,
    document,
    () => {},
    () => {},
    () => 80,
    testViewerOptions,
  )
}

function commandByLabel(label: string): GitCommand {
  const command = GIT_COMMANDS.find((candidate) => candidate.label === label)
  if (!command) throw new Error(`Missing command: ${label}`)
  return command
}

function createInterceptedCommandPi(options: {
  readonly args: readonly string[]
  readonly result?: Partial<RawGitResult>
  readonly beforeResult?: () => Promise<void>
}) {
  const tracker = createTrackingGitPi()
  let commandCalls = 0
  const pi = {
    exec: async (
      command: string,
      args: string[],
      execOptions?: { cwd?: string; signal?: AbortSignal; timeout?: number },
    ) => {
      if (args.length === options.args.length && args.every((value, index) => value === options.args[index])) {
        commandCalls++
        await options.beforeResult?.()
        return { stdout: "", stderr: "", code: 0, killed: false, ...options.result }
      }
      return tracker.pi.exec(command, args, execOptions)
    },
  } as unknown as ExtensionAPI
  return { pi, calls: tracker.calls, commandCalls: () => commandCalls }
}

function assertFullCommandRefresh(
  viewer: CommandRefreshViewer,
  fresh: DiffDocument,
  intercepted: ReturnType<typeof createInterceptedCommandPi>,
  expectedRootCalls: number,
): void {
  assert.equal(intercepted.commandCalls(), 1)
  assert.equal(intercepted.calls.filter((call) => call.args[0] === "status").length, 1)
  assert.equal(
    intercepted.calls.filter((call) => call.args.join(" ") === "rev-parse --show-toplevel").length,
    expectedRootCalls,
  )
  assert.deepEqual(viewer.currentDocument(), fresh)
}

test("fetch variants and pushes use one status process and preserve metadata-only viewer state", async () => {
  const repo = await createTempGitRepository()
  try {
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    for (const label of ["Fetch", "Fetch + Prune", "Fetch All Remotes", "Push", "Push Tags"]) {
      const command = commandByLabel(label)
      const intercepted = createInterceptedCommandPi({ args: command.args })
      const viewer = createViewer(intercepted.pi, repo.path, current)
      viewer.render(120)
      viewer.setScroll(17)
      const cacheBefore = viewer.cacheStats()

      await viewer.runCommand(command)

      assert.equal(intercepted.commandCalls(), 1)
      assert.equal(intercepted.calls.filter((call) => call.args[0] === "status").length, 1)
      assert.equal(
        intercepted.calls.some((call) => call.args.includes("diff")),
        false,
      )
      assert.equal(viewer.currentDocument().files, current.files)
      assert.equal(viewer.currentDocument().raw, current.raw)
      assert.equal(viewer.scroll(), 17)
      assert.equal(viewer.visibleError(), undefined)
      assert.deepEqual(viewer.cacheStats(), cacheBefore)
    }
  } finally {
    await repo.cleanup()
  }
})

test("a successful ref-only command preserves dirty viewer caches when content is unchanged", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "dirty content\n")
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const command = commandByLabel("Fetch")
    const intercepted = createInterceptedCommandPi({ args: command.args })
    const viewer = createViewer(intercepted.pi, repo.path, current)
    viewer.render(120)
    const cacheBefore = viewer.cacheStats()

    await viewer.runCommand(command)

    assert.equal(viewer.currentDocument().files, current.files)
    assert.equal(viewer.currentDocument().raw, current.raw)
    assert.deepEqual(viewer.cacheStats(), cacheBefore)
    assert.equal(intercepted.calls.filter((call) => call.args[0] === "status").length, 1)
    assert.equal(
      intercepted.calls.some((call) => call.args.includes("diff")),
      false,
    )
  } finally {
    await repo.cleanup()
  }
})

test("a failed ref-only command detects content changes behind an unchanged dirty status", async () => {
  const repo = await createTempGitRepository()
  try {
    await writeRepoFile(repo.path, "tracked.txt", "dirty before fetch\n")
    const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    const command = commandByLabel("Fetch")
    const intercepted = createInterceptedCommandPi({
      args: command.args,
      result: { code: 1, stderr: "fetch rejected" },
      beforeResult: () => writeRepoFile(repo.path, "tracked.txt", "changed by fetch hook\n"),
    })
    const viewer = createViewer(intercepted.pi, repo.path, current)

    await viewer.runCommand(command)

    const fresh = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
    assertFullCommandRefresh(viewer, fresh, intercepted, 1)
    assert.match(viewer.visibleError() ?? "", /fetch rejected/u)
  } finally {
    await repo.cleanup()
  }
})

test("content-changing commands always perform full refreshes", async () => {
  for (const scenario of [
    { label: "Pull", code: 0, path: "pull.txt" },
    { label: "Pull (FF Only)", code: 0, path: "ff-only.txt" },
    { label: "Pull (Rebase)", code: 1, path: "rebase-conflict.txt" },
    { label: "Update Submodules", code: 1, path: "submodule-update.txt" },
  ]) {
    const repo = await createTempGitRepository()
    try {
      const current = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
      const command = commandByLabel(scenario.label)
      const intercepted = createInterceptedCommandPi({
        args: command.args,
        result: scenario.code === 0 ? undefined : { code: scenario.code, stderr: "partial command failure" },
        beforeResult: () => writeRepoFile(repo.path, scenario.path, "command-created content\n"),
      })
      const viewer = createViewer(intercepted.pi, repo.path, current)

      await viewer.runCommand(command)

      const fresh = await loadWorkingTreeDiff(createTrackingGitPi().pi, context(repo.path))
      assertFullCommandRefresh(viewer, fresh, intercepted, 2)
      if (scenario.code === 0) {
        assert.equal(viewer.visibleError(), undefined)
      } else {
        assert.match(viewer.visibleError() ?? "", /partial command failure/u)
      }
    } finally {
      await repo.cleanup()
    }
  }
})
