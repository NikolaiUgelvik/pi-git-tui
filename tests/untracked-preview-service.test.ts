import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { GitExecResult } from "../src/types.js"
import { readUntrackedDiffPreviews } from "../src/untracked-preview-service.js"
import { deferred, flushPromises } from "./helpers/deferred.js"
import { realGitPi, runGit } from "./helpers/real-git.js"
import { gitResult } from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }
type Handler = (args: string[], options?: ExecOptions) => GitExecResult | Promise<GitExecResult>

function createPi(handler: Handler): ExtensionAPI {
  return {
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      assert.equal(command, "git")
      return handler(args, options)
    },
  } as unknown as ExtensionAPI
}

function pathArgument(args: string[]): string {
  return args.at(-1) ?? ""
}

function unbornHeadResult(): GitExecResult {
  return gitResult("", 128, "fatal: invalid object name 'HEAD'.")
}

async function temporaryFiles(count: number, contents = "x"): Promise<{ root: string; paths: string[] }> {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-preview-"))
  const paths = Array.from({ length: count }, (_, index) => `file-${String(index).padStart(4, "0")}.txt`)
  await Promise.all(paths.map((path) => writeFile(join(root, path), contents)))
  return { root, paths }
}

test("one thousand previews stay ordered, complete, and capped at four workers and one hundred patches", async () => {
  const { root, paths } = await temporaryFiles(1000)
  let active = 0
  let gitCalls = 0
  let peak = 0
  let patchCalls = 0
  const pi = createPi(async (args) => {
    gitCalls += 1
    if (args.includes("ls-files")) {
      return gitResult()
    }
    if (args.includes("ls-tree")) {
      return unbornHeadResult()
    }
    if (args.includes("--no-index")) {
      active += 1
      peak = Math.max(peak, active)
      patchCalls += 1
      await tick()
      active -= 1
      const path = pathArgument(args)
      return gitResult(`diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x`, 1)
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, paths, "unborn")

    assert.equal(peak, 4)
    assert.equal(gitCalls, 102)
    assert.equal(patchCalls, 100)
    assert.equal(previews.length, 1000)
    assert.deepEqual(
      previews.map((preview) => preview.path),
      paths,
    )
    assert.equal(previews.filter((preview) => preview.include).length, 1000)
    assert.equal(previews.filter((preview) => preview.raw.length > 0).length, 100)
    assert.ok(previews.reduce((bytes, preview) => bytes + Buffer.byteLength(preview.raw), 0) <= 1024 * 1024)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("aggregate output and file budgets keep later paths as placeholders", async () => {
  const { root, paths } = await temporaryFiles(4)
  let patchCalls = 0
  const pi = createPi((args) => {
    if (args.includes("ls-files")) {
      return gitResult()
    }
    if (args.includes("ls-tree")) {
      return unbornHeadResult()
    }
    if (args.includes("--no-index")) {
      patchCalls += 1
      return gitResult("1234567890", 1)
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, paths, "unborn", undefined, {
      concurrency: 2,
      maxFileBytes: 100,
      maxPreviewBytes: 20,
      maxPreviewFiles: 3,
    })

    assert.equal(patchCalls, 3)
    assert.deepEqual(
      previews.map(({ include, raw }) => ({ include, raw })),
      [
        { include: true, raw: "1234567890" },
        { include: true, raw: "1234567890" },
        { include: true, raw: "" },
        { include: true, raw: "" },
      ],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("budget exhaustion never bypasses the staged-after-discovery race check", async () => {
  const { root, paths } = await temporaryFiles(2)
  const racedPath = paths[1] ?? ""
  let patchCalls = 0
  const pi = createPi((args) => {
    if (args.includes("ls-files")) {
      return gitResult(`100644 abc 0\t${racedPath}\0`)
    }
    if (args.includes("ls-tree")) {
      return unbornHeadResult()
    }
    if (args.includes("--no-index")) {
      patchCalls += 1
      return gitResult("patch", 1)
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, paths, "unborn", undefined, {
      maxPreviewFiles: 0,
    })
    assert.equal(patchCalls, 0)
    assert.equal(previews[0]?.include, true)
    assert.equal(previews[0]?.raw, "")
    assert.equal(previews[1]?.include, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an initially unborn HEAD is rechecked before an untracked preview is admitted", async () => {
  const { root, paths } = await temporaryFiles(1)
  let patchCalls = 0
  const pi = createPi((args) => {
    if (args.includes("ls-files")) {
      return gitResult()
    }
    if (args.includes("ls-tree")) {
      return gitResult(`${paths[0]}\0`)
    }
    if (args.includes("--no-index")) {
      patchCalls += 1
      return gitResult("stale patch", 1)
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, paths, "unborn")
    assert.equal(patchCalls, 0)
    assert.equal(previews[0]?.include, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a batched index failure prevents HEAD and patch work from starting", async () => {
  const { root, paths } = await temporaryFiles(4)
  let gitCalls = 0
  const pi = createPi((args) => {
    gitCalls += 1
    if (args.includes("ls-files")) {
      return gitResult("", 2, "fatal: index unavailable")
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    await assert.rejects(readUntrackedDiffPreviews(pi, root, paths, "unborn"), /index unavailable/u)
    assert.equal(gitCalls, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("aborting the batched index check prevents HEAD and patch work from starting", async () => {
  const { root, paths } = await temporaryFiles(8)
  const controller = new AbortController()
  const pending = deferred<GitExecResult>()
  let started = 0
  const pi = createPi((args) => {
    if (!args.includes("ls-files")) {
      return gitResult("", 99, `unexpected git ${args.join(" ")}`)
    }
    started += 1
    return pending.promise
  })

  try {
    const loading = readUntrackedDiffPreviews(pi, root, paths, "unborn", controller.signal, { concurrency: 2 })
    await flushPromises()
    assert.equal(started, 1)
    controller.abort()
    pending.resolve(gitResult())
    await assert.rejects(loading, (error: unknown) => error instanceof DOMException && error.name === "AbortError")
    assert.equal(started, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an expected ENOTDIR disappearance is omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-enotdir-"))
  await writeFile(join(root, "parent"), "not a directory")
  const pi = createPi((args) => {
    if (args.includes("ls-files")) return gitResult()
    if (args.includes("ls-tree")) return unbornHeadResult()
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, ["parent/child"], "unborn")
    assert.deepEqual(previews, [{ path: "parent/child", include: false, raw: "" }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an unexpected lstat failure rejects the complete preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-lstat-failure-"))
  await symlink("loop", join(root, "loop"))
  const pi = createPi((args) => {
    if (args.includes("ls-files")) return gitResult()
    if (args.includes("ls-tree")) return unbornHeadResult()
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    await assert.rejects(
      readUntrackedDiffPreviews(pi, root, ["loop/child"], "unborn"),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ELOOP",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a real broken symlink produces a symlink patch instead of disappearing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-symlink-"))
  try {
    runGit(root, ["init", "--quiet", "--initial-branch=main"])
    await symlink("nowhere", join(root, "broken"))

    const previews = await readUntrackedDiffPreviews(realGitPi(), root, ["broken"], "unborn")

    assert.equal(previews[0]?.include, true)
    assert.match(previews[0]?.raw ?? "", /new file mode 120000/u)
    assert.match(previews[0]?.raw ?? "", /\+nowhere/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("large, missing, directory, binary, and symlink paths preserve existing safeguards", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-untracked-kinds-"))
  await writeFile(join(root, "large.bin"), "x".repeat(30))
  await mkdir(join(root, "directory"))
  await writeFile(join(root, "binary.bin"), "x")
  await writeFile(join(root, "target.txt"), "x")
  await symlink("target.txt", join(root, "linked.txt"))
  await symlink("nowhere", join(root, "broken.txt"))
  const paths = ["large.bin", "missing.txt", "directory", "binary.bin", "linked.txt", "broken.txt"]
  const diffCalls: string[] = []
  const pi = createPi((args) => {
    if (args.includes("ls-files")) {
      return gitResult()
    }
    if (args.includes("ls-tree")) {
      return unbornHeadResult()
    }
    if (args.includes("--no-index")) {
      const path = pathArgument(args)
      diffCalls.push(path)
      return path === "binary.bin"
        ? gitResult("Binary files /dev/null and binary.bin differ", 1)
        : gitResult(`patch ${path}`, 1)
    }
    return gitResult("", 99, `unexpected git ${args.join(" ")}`)
  })

  try {
    const previews = await readUntrackedDiffPreviews(pi, root, paths, "unborn", undefined, {
      maxFileBytes: 20,
      maxPreviewBytes: 1000,
      maxPreviewFiles: 10,
    })

    assert.deepEqual(diffCalls.sort(), ["binary.bin", "broken.txt", "linked.txt"])
    assert.deepEqual(
      previews.map(({ path, include, raw }) => ({ path, include, raw })),
      [
        { path: "large.bin", include: true, raw: "" },
        { path: "missing.txt", include: false, raw: "" },
        { path: "directory", include: true, raw: "" },
        { path: "binary.bin", include: true, raw: "Binary files /dev/null and binary.bin differ" },
        { path: "linked.txt", include: true, raw: "patch linked.txt" },
        { path: "broken.txt", include: true, raw: "patch broken.txt" },
      ],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
