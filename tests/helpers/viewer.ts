import { setImmediate as tick } from "node:timers/promises"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { createDiffSlice } from "../../src/diff-document.js"
import type { DiffFile, GitExecResult, HeadState, WorkingTreeDocument } from "../../src/types.js"

export const testTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme

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
  const workingFiles = options.workingFiles ?? []
  const stagedFiles = options.stagedFiles ?? []
  return {
    mode: "working",
    title: options.title ?? "Working tree and index",
    subtitle: `${cwd} (main)`,
    repositoryState: options.repositoryState ?? "ready",
    headState: options.headState ?? "present",
    working: createDiffSlice("working", "", workingFiles),
    staged: createDiffSlice("staged", "", stagedFiles),
  }
}

export interface SnapshotResultOptions {
  branch?: string
  head?: string
  stagedDiff?: string
  workingDiff?: string
}

export function workingSnapshotResult(
  args: string[],
  cwd = "/repo",
  options: SnapshotResultOptions = {},
): GitExecResult | undefined {
  const branch = options.branch ?? "main"
  const command = args.join(" ")
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

export async function flushViewerWork(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await tick()
  }
}
