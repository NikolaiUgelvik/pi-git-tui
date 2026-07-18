import { lstat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

export type GitFileState =
  | { readonly kind: "file"; readonly bytes: number; readonly signature: string; readonly symlink: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "unsupported"; readonly description: string }

function safeSize(size: bigint): number {
  return size > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(size)
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

function repositoryFile(root: string, path: string): string | undefined {
  if (isAbsolute(path)) {
    return
  }
  const absolute = resolve(root, path)
  const fromRoot = relative(root, absolute)
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot)) ? absolute : undefined
}

export async function loadGitFileState(root: string, path: string): Promise<GitFileState> {
  const absolute = repositoryFile(root, path)
  if (!absolute) {
    return { kind: "unsupported", description: "path is outside the repository" }
  }
  try {
    const info = await lstat(absolute, { bigint: true })
    if (info.isFile() || info.isSymbolicLink()) {
      return {
        kind: "file",
        bytes: safeSize(info.size),
        signature: [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":"),
        symlink: info.isSymbolicLink(),
      }
    }
    return {
      kind: "unsupported",
      description: info.isDirectory() ? "path is a directory" : "path is not a regular file or symbolic link",
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { kind: "missing" }
    }
    return {
      kind: "unsupported",
      description: error instanceof Error ? error.message : "path could not be inspected",
    }
  }
}

export function sameGitFileState(before: GitFileState, after: GitFileState): boolean {
  if (before.kind !== after.kind) {
    return false
  }
  if (before.kind === "file" && after.kind === "file") {
    return before.signature === after.signature
  }
  if (before.kind === "unsupported" && after.kind === "unsupported") {
    return before.description === after.description
  }
  return true
}
