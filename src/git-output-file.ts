import { createReadStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type GitRunOptions, runGit, throwIfGitAborted } from "./git-service.js"

export async function withGitOutputFile<T>(
  pi: ExtensionAPI,
  cwd: string,
  args: (outputPath: string) => readonly string[],
  consume: (outputPath: string) => Promise<T>,
  options: GitRunOptions = {},
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "pi-git-tui-output-"))
  const outputPath = join(directory, "git-output")
  try {
    await runGit(pi, cwd, args(outputPath), options)
    throwIfGitAborted(options.signal)
    return await consume(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function* readNulRecords(outputPath: string, signal?: AbortSignal): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8")
  let buffered = ""
  for await (const bytes of createReadStream(outputPath)) {
    throwIfGitAborted(signal)
    buffered += decoder.write(bytes as Buffer)
    let separator = buffered.indexOf("\0")
    while (separator >= 0) {
      yield buffered.slice(0, separator)
      buffered = buffered.slice(separator + 1)
      separator = buffered.indexOf("\0")
    }
  }
  buffered += decoder.end()
  if (buffered) throw new Error("Git output ended without a NUL record terminator")
}

function splitCompleteLines(buffered: string): { lines: string[]; remainder: string } {
  const lines: string[] = []
  let offset = 0
  let newline = buffered.indexOf("\n", offset)
  while (newline >= 0) {
    lines.push(buffered.slice(offset, newline + 1))
    offset = newline + 1
    newline = buffered.indexOf("\n", offset)
  }
  return { lines, remainder: buffered.slice(offset) }
}

export async function* readPatchChunks(outputPath: string, signal?: AbortSignal): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8")
  let buffered = ""
  let current = ""
  for await (const bytes of createReadStream(outputPath)) {
    throwIfGitAborted(signal)
    buffered += decoder.write(bytes as Buffer)
    const split = splitCompleteLines(buffered)
    buffered = split.remainder
    for (const line of split.lines) {
      if (line.startsWith("diff --git ") && current) {
        yield current
        current = ""
      }
      current += line
    }
  }
  buffered += decoder.end()
  if (buffered.startsWith("diff --git ") && current) {
    yield current
    current = buffered
  } else {
    current += buffered
  }
  if (current) yield current
}
