import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  GitStatusParseError,
  loadWorkingTreeSnapshot,
  parsePorcelainV2,
  workingTreeBranchLabel,
} from "../src/git-status.js"

const oidA = "a".repeat(40)
const oidB = "b".repeat(40)
const oidC = "c".repeat(40)
const oidZero = "0".repeat(40)

function porcelain(...records: string[]): string {
  return `${records.join("\0")}\0`
}

test("parsePorcelainV2 preserves metadata, record state, and unusual NUL-delimited paths", () => {
  const stagedPath = " leading space\nline\tname.ts"
  const submodulePath = "vendor/module"
  const renamedPath = "destination name.ts"
  const renameSource = "source\nname.ts"
  const copiedPath = "copied[1].ts"
  const copySource = "copy source.ts"
  const conflictPath = "conflict.ts"
  const untrackedPaths = ["-leading-dash", "glob*[x]?.ts", "unicode-λ.ts", "tab\tand\nnewline.ts"]
  const raw = porcelain(
    `# branch.oid ${oidA}`,
    "# branch.head feature/status",
    "# branch.upstream origin/feature/status",
    "# branch.ab +12 -3",
    "# future.header ignored",
    `1 M. N... 100644 100644 100644 ${oidA} ${oidB} ${stagedPath}`,
    `1 .M SCMU 160000 160000 160000 ${oidB} ${oidC} ${submodulePath}`,
    `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R090 ${renamedPath}`,
    renameSource,
    `2 C. N... 100644 100644 100644 ${oidA} ${oidB} C100 ${copiedPath}`,
    copySource,
    `u UU N... 100644 100644 100644 100644 ${oidA} ${oidB} ${oidC} ${conflictPath}`,
    ...untrackedPaths.map((path) => `? ${path}`),
    "! ignored.tmp",
  )

  const snapshot = parsePorcelainV2(raw)

  assert.deepEqual(snapshot.head, { kind: "attached", oid: oidA, branch: "feature/status" })
  assert.deepEqual(snapshot.upstream, { name: "origin/feature/status", ahead: 12, behind: 3 })
  assert.equal(workingTreeBranchLabel(snapshot), "feature/status ↑12 ↓3")
  assert.deepEqual(snapshot.entries, [
    {
      kind: "ordinary",
      path: stagedPath,
      indexStatus: "M",
      worktreeStatus: ".",
      submodule: "N...",
    },
    {
      kind: "ordinary",
      path: submodulePath,
      indexStatus: ".",
      worktreeStatus: "M",
      submodule: "SCMU",
    },
    {
      kind: "rename",
      path: renamedPath,
      originalPath: renameSource,
      indexStatus: "R",
      worktreeStatus: ".",
      submodule: "N...",
      similarity: { kind: "rename", score: 90 },
    },
    {
      kind: "rename",
      path: copiedPath,
      originalPath: copySource,
      indexStatus: "C",
      worktreeStatus: ".",
      submodule: "N...",
      similarity: { kind: "copy", score: 100 },
    },
    {
      kind: "unmerged",
      path: conflictPath,
      indexStatus: "U",
      worktreeStatus: "U",
      submodule: "N...",
    },
  ])
  assert.deepEqual(snapshot.stagedPaths, new Set([stagedPath, renamedPath, copiedPath]))
  assert.deepEqual(snapshot.conflictedPaths, new Set([conflictPath]))
  assert.deepEqual(snapshot.untrackedPaths, untrackedPaths)
  assert.deepEqual(
    snapshot.headTrackedPaths,
    new Set([stagedPath, submodulePath, renameSource, copySource, conflictPath]),
  )
})

test("parsePorcelainV2 distinguishes initial and detached HEAD states", () => {
  const initial = parsePorcelainV2(
    porcelain(
      "# branch.oid (initial)",
      "# branch.head main",
      `1 A. N... 000000 100644 100644 ${oidZero} ${oidA} staged.txt`,
      "? untracked.txt",
    ),
  )
  assert.deepEqual(initial.head, { kind: "initial", branch: "main" })
  assert.equal(workingTreeBranchLabel(initial), "main")
  assert.deepEqual(initial.headTrackedPaths, new Set())

  const oddlyNamedInitial = parsePorcelainV2(porcelain("# branch.oid (initial)", "# branch.head (detached)"))
  assert.deepEqual(oddlyNamedInitial.head, { kind: "initial", branch: "(detached)" })

  const detached = parsePorcelainV2(porcelain(`# branch.oid ${oidB}`, "# branch.head (detached)"))
  assert.deepEqual(detached.head, { kind: "detached", oid: oidB })
  assert.equal(workingTreeBranchLabel(detached), `detached ${oidB.slice(0, 7)}`)
})

test("ahead-only, behind-only, and diverged counts format deterministically", () => {
  const cases = [
    ["+2 -0", "main ↑2"],
    ["+0 -4", "main ↓4"],
    ["+2 -4", "main ↑2 ↓4"],
  ] as const
  for (const [counts, expected] of cases) {
    const snapshot = parsePorcelainV2(
      porcelain(`# branch.oid ${oidA}`, "# branch.head main", "# branch.upstream origin/main", `# branch.ab ${counts}`),
    )
    assert.equal(workingTreeBranchLabel(snapshot), expected)
  }
})

test("an upstream without branch.ab remains count-free", () => {
  const snapshot = parsePorcelainV2(
    porcelain(`# branch.oid ${oidA}`, "# branch.head main", "# branch.upstream origin/main"),
  )

  assert.deepEqual(snapshot.upstream, { name: "origin/main" })
  assert.equal(workingTreeBranchLabel(snapshot), "main")
})

test("unmerged forms populate conflict state without claiming commit-ready staging", () => {
  const forms = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]
  const records = forms.map(
    (xy, index) => `u ${xy} N... 100644 100644 100644 100644 ${oidA} ${oidB} ${oidC} conflict-${index}.ts`,
  )
  const snapshot = parsePorcelainV2(porcelain(`# branch.oid ${oidA}`, "# branch.head main", ...records))

  assert.deepEqual(
    snapshot.entries.map((entry) => `${entry.indexStatus}${entry.worktreeStatus}`),
    forms,
  )
  assert.equal(snapshot.conflictedPaths.size, forms.length)
  assert.deepEqual(snapshot.stagedPaths, new Set())
})

test("malformed or unknown entry records fail instead of silently dropping files", () => {
  const headers = [`# branch.oid ${oidA}`, "# branch.head main"]
  const malformed = [
    porcelain(...headers, `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R100 renamed.ts`),
    porcelain(...headers, "1 M. N... missing-fields"),
    porcelain(...headers, "x unsupported"),
    porcelain(...headers, `1 M. BAD! 100644 100644 100644 ${oidA} ${oidB} file.ts`),
    porcelain(...headers, `1 ZZ N... 100644 100644 100644 ${oidA} ${oidB} file.ts`),
    porcelain(...headers, `1 M. N... badmode 100644 100644 ${oidA} ${oidB} file.ts`),
    porcelain(...headers, "# branch.ab not-counts"),
    porcelain("# branch.oid abc", "# branch.head main"),
    porcelain("? no-headers.ts"),
  ]

  for (const raw of malformed) {
    assert.throws(() => parsePorcelainV2(raw), GitStatusParseError)
  }
})

test("loadWorkingTreeSnapshot runs the fixed porcelain-v2 status command", async () => {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = []
  const raw = porcelain(`# branch.oid ${oidA}`, "# branch.head main")
  const pi = {
    exec: async (command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ command, args, cwd: options?.cwd })
      return { stdout: raw, stderr: "", code: 0, killed: false }
    },
  } as unknown as ExtensionAPI

  const snapshot = await loadWorkingTreeSnapshot(pi, "/linked-worktree")

  assert.deepEqual(snapshot.head, { kind: "attached", oid: oidA, branch: "main" })
  assert.deepEqual(calls, [
    {
      command: "git",
      args: [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--find-renames",
      ],
      cwd: "/linked-worktree",
    },
  ])
})
