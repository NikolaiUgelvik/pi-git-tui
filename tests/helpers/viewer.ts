import { setImmediate as tick } from "node:timers/promises"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { SettingsListTheme } from "@earendil-works/pi-tui"
import { buildWorkingTreeDocument } from "../../src/diff-document.js"
import { parseDiff } from "../../src/diff-parser-core.js"
import { DEFAULT_PLUGIN_SETTINGS } from "../../src/plugin-settings.js"
import type { DiffFile, GitExecResult, HeadState, WorkingTreeDocument } from "../../src/types.js"
import type { DiffViewerOptions } from "../../src/viewer-operation-base.js"

export const testTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

export const testSettingsListTheme: SettingsListTheme = {
  label: (text) => text,
  value: (text) => text,
  description: (text) => text,
  cursor: "> ",
  hint: (text) => text,
}

export const testViewerOptions: DiffViewerOptions = {
  settings: DEFAULT_PLUGIN_SETTINGS,
  settingsListTheme: () => testSettingsListTheme,
  saveSettings: async () => {},
}

export const testUnwrappedViewerOptions: DiffViewerOptions = {
  ...testViewerOptions,
  settings: { diff: { wrap: false } },
}

export function gitResult(stdout = "", code = 0, stderr = "", killed = false): GitExecResult {
  return { stdout, stderr, code, killed }
}

export interface WorkingDocumentOptions {
  workingFiles?: DiffFile[]
  stagedFiles?: DiffFile[]
  headState?: HeadState
  repositoryState?: "ready" | "missing"
  title?: string
}

export function workingDocument(cwd = "/repo", options: WorkingDocumentOptions = {}): WorkingTreeDocument {
  return buildWorkingTreeDocument({
    title: options.title ?? "Working tree and index",
    subtitle: `${cwd} (main)`,
    repositoryState: options.repositoryState ?? "ready",
    headState: options.headState ?? "present",
    workingRaw: "",
    stagedRaw: "",
    workingOmittedFiles: options.workingFiles ?? [],
    stagedOmittedFiles: options.stagedFiles ?? [],
  })
}

export interface SnapshotResultOptions {
  branch?: string
  head?: string
  stagedDiff?: string
  workingDiff?: string
}

function fixtureStatus(options: SnapshotResultOptions, branch: string): string {
  const oid = (options.head ?? "a".repeat(40)).padEnd(40, "0").slice(0, 40)
  const paths = new Map<string, { staged: boolean; working: boolean }>()
  for (const file of parseDiff(options.stagedDiff ?? "")) {
    paths.set(file.path, { staged: true, working: paths.get(file.path)?.working ?? false })
  }
  for (const file of parseDiff(options.workingDiff ?? "")) {
    paths.set(file.path, { staged: paths.get(file.path)?.staged ?? false, working: true })
  }
  const records = [`# branch.oid ${oid}`, `# branch.head ${branch}`]
  const zero = "0".repeat(40)
  for (const [path, state] of paths) {
    const xy = `${state.staged ? "M" : "."}${state.working ? "M" : "."}`
    records.push(`1 ${xy} N... 100644 100644 100644 ${zero} ${zero} ${path}`)
  }
  return `${records.join("\0")}\0`
}

export function workingSnapshotResult(
  args: string[],
  cwd = "/repo",
  options: SnapshotResultOptions = {},
): GitExecResult | undefined {
  const branch = options.branch ?? "main"
  const command = args.join(" ")
  if (args[0] === "status" && args.includes("--porcelain=v2")) return gitResult(fixtureStatus(options, branch))
  const separator = args.lastIndexOf("--")
  const literalPaths = separator < 0 ? [] : args.slice(separator + 1)
  const oid = "1".repeat(40)
  if (args.includes("ls-tree")) {
    return gitResult(literalPaths.map((path) => `100644 blob ${oid} 1\t${path}\0`).join(""))
  }
  if (args.includes("ls-files") && args.includes("--stage")) {
    return gitResult(literalPaths.map((path) => `100644 ${oid} 0\t${path}\0`).join(""))
  }
  if (args[0] === "cat-file" && args[1] === "-s") return gitResult("1\n")
  const responses: Record<string, GitExecResult> = {
    "rev-parse --show-toplevel": gitResult(`${cwd}\n`),
    "rev-parse --verify HEAD": gitResult(`${options.head ?? "abcdef"}\n`),
    "branch --show-current": gitResult(`${branch}\n`),
    "ls-files --others --exclude-standard -z": gitResult(),
    "diff --name-only --diff-filter=U -z": gitResult(),
    "rev-list --left-right --count @{upstream}...HEAD": gitResult(
      "",
      128,
      `fatal: no upstream configured for branch '${branch}'`,
    ),
  }
  const response = responses[command]
  if (response) {
    return response
  }
  if (args.includes("diff")) {
    return gitResult(args.includes("--cached") ? options.stagedDiff : options.workingDiff)
  }
}

export async function flushViewerWork(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await tick()
  }
}

export async function waitForViewerIdle(viewer: { busy(): boolean }): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!viewer.busy()) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      if (!viewer.busy()) return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Viewer operation did not settle")
}
