import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { GitExecResult } from "../../src/types.js"

interface ExecOptions {
  cwd?: string
  signal?: AbortSignal
  timeout?: number
}

function gitResult(stdout = "", code = 0, stderr = "", killed = false): GitExecResult {
  return { stdout, stderr, code, killed }
}

export function realGitPi(): ExtensionAPI {
  return {
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: "utf8" })
      return gitResult(result.stdout ?? "", result.status ?? 1, result.stderr ?? "", result.signal !== null)
    },
  } as unknown as ExtensionAPI
}

export function runGit(root: string, args: string[], expectedCode = 0): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  assert.equal(result.status, expectedCode, result.stderr)
  return result.stdout
}
