import { parseDiff } from "./diff-parser-core.js"
import type {
  CommitDocument,
  CommitSummary,
  DiffDocument,
  DiffFile,
  DiffScope,
  DiffSlice,
  DiffStats,
  FileStageState,
  HeadState,
  RepositoryState,
  WorkingTreeDocument,
  WorkingTreeView,
} from "./types.js"

export interface WorkingTreeDocumentInput {
  title: string
  subtitle: string
  stagedRaw: string
  workingRaw: string
  untrackedPaths?: Iterable<string>
  conflictedPaths?: Iterable<string>
  repositoryState?: RepositoryState
  headState: HeadState
}

export interface CommitDocumentInput {
  title: string
  subtitle: string
  raw: string
  commit: CommitSummary
  headState?: HeadState
}

export function diffFileAliases(file: DiffFile | undefined): string[] {
  if (!file) {
    return []
  }
  return [...new Set([file.path, file.oldPath, file.newPath].filter(isUsablePath))]
}

export function diffFileOperationPaths(file: DiffFile | undefined): string[] {
  if (file?.status === "copied") {
    return [...new Set([file.path, file.newPath].filter(isUsablePath))]
  }
  return diffFileAliases(file)
}

function isUsablePath(path: string | undefined): path is string {
  return path !== undefined && path !== "" && path !== "/dev/null"
}

function identityAliases(file: DiffFile): string[] {
  if (file.status === "copied") {
    return [...new Set([file.path, file.newPath].filter(isUsablePath))]
  }
  return diffFileAliases(file)
}

function filesShareIdentity(left: DiffFile, right: DiffFile): boolean {
  const rightAliases = new Set(identityAliases(right))
  return identityAliases(left).some((path) => rightAliases.has(path))
}

function fileMatchesPaths(file: DiffFile, paths: Set<string>): boolean {
  return diffFileAliases(file).some((path) => paths.has(path))
}

function countChangedLines(files: DiffFile[]): Pick<DiffStats, "additions" | "deletions"> {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    for (const line of file.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions += 1
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions += 1
      }
    }
  }
  return { additions, deletions }
}

function diffStats(files: DiffFile[]): DiffStats {
  return { files: files.length, ...countChangedLines(files) }
}

export function createDiffSlice(scope: DiffScope, raw: string, files: DiffFile[] = parseDiff(raw)): DiffSlice {
  return { scope, raw, files, stats: diffStats(files) }
}

function placeholderFile(path: string, options: { conflicted?: boolean; untracked?: boolean }): DiffFile {
  const conflicted = options.conflicted === true
  return {
    path,
    oldPath: options.untracked ? "/dev/null" : path,
    newPath: path,
    status: conflicted ? "conflicted" : "added",
    untracked: options.untracked || undefined,
    lines: conflicted ? [`diff --cc ${path}`, `Unmerged path: ${path}`] : [],
  }
}

function ensurePathFiles(
  files: DiffFile[],
  paths: Set<string>,
  options: { conflicted?: boolean; untracked?: boolean },
): void {
  for (const path of paths) {
    if (!files.some((file) => diffFileAliases(file).includes(path))) {
      files.push(placeholderFile(path, options))
    }
  }
}

function fileStageState(scope: WorkingTreeView, mixed: boolean, conflicted: boolean): FileStageState {
  if (conflicted) {
    return "conflicted"
  }
  if (mixed) {
    return "mixed"
  }
  return scope === "staged" ? "staged" : "unstaged"
}

function mergedAlias(current: string | undefined, path: string, matching: string | undefined): string | undefined {
  if (!matching || (current && current !== path)) {
    return current
  }
  return matching
}

function decoratedFile(
  file: DiffFile,
  scope: WorkingTreeView,
  otherFiles: DiffFile[],
  conflictedPaths: Set<string>,
  untrackedPaths: Set<string>,
): DiffFile {
  const conflicted = fileMatchesPaths(file, conflictedPaths)
  const matchingFile = otherFiles.find((other) => filesShareIdentity(file, other))
  const matchingOldPath = matchingFile?.status === "copied" ? undefined : matchingFile?.oldPath
  return {
    ...file,
    oldPath: mergedAlias(file.oldPath, file.path, matchingOldPath),
    newPath: mergedAlias(file.newPath, file.path, matchingFile?.newPath),
    status: conflicted ? "conflicted" : file.status,
    stageState: fileStageState(scope, matchingFile !== undefined, conflicted),
    untracked: fileMatchesPaths(file, untrackedPaths) || undefined,
  }
}

export function buildWorkingTreeDocument(input: WorkingTreeDocumentInput): WorkingTreeDocument {
  const untrackedPaths = new Set(input.untrackedPaths)
  const conflictedPaths = new Set(input.conflictedPaths)
  const stagedFiles = parseDiff(input.stagedRaw)
  const workingFiles = parseDiff(input.workingRaw)
  ensurePathFiles(workingFiles, untrackedPaths, { untracked: true })
  ensurePathFiles(workingFiles, conflictedPaths, { conflicted: true })
  ensurePathFiles(stagedFiles, conflictedPaths, { conflicted: true })
  const staged = stagedFiles.map((file) => decoratedFile(file, "staged", workingFiles, conflictedPaths, untrackedPaths))
  const working = workingFiles.map((file) =>
    decoratedFile(file, "working", stagedFiles, conflictedPaths, untrackedPaths),
  )
  return {
    mode: "working",
    title: input.title,
    subtitle: input.subtitle,
    repositoryState: input.repositoryState ?? "ready",
    headState: input.headState,
    staged: createDiffSlice("staged", input.stagedRaw, staged),
    working: createDiffSlice("working", input.workingRaw, working),
  }
}

export function emptyWorkingTreeDocument(
  title: string,
  subtitle: string,
  repositoryState: RepositoryState = "ready",
  headState: HeadState = "unborn",
): WorkingTreeDocument {
  return buildWorkingTreeDocument({ title, subtitle, stagedRaw: "", workingRaw: "", repositoryState, headState })
}

export function buildCommitDocument(input: CommitDocumentInput): CommitDocument {
  return {
    mode: "commit",
    title: input.title,
    subtitle: input.subtitle,
    repositoryState: "ready",
    headState: input.headState ?? "present",
    commit: input.commit,
    diff: createDiffSlice("commit", input.raw),
  }
}

export function selectDiffSlice(document: DiffDocument, view: WorkingTreeView = "working"): DiffSlice {
  return document.mode === "commit" ? document.diff : document[view]
}

export function workingTreeHasConflicts(document: WorkingTreeDocument): boolean {
  return [...document.staged.files, ...document.working.files].some((file) => file.stageState === "conflicted")
}
