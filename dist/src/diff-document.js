import { parseDiff } from "./diff-parser-core.js";
import { textLineCount, utf8Bytes } from "./git-patch.js";
export function diffFileAliases(file) {
    if (!file) {
        return [];
    }
    return [...new Set([file.path, file.oldPath, file.newPath].filter(isUsablePath))];
}
export function diffFileOperationPaths(file) {
    if (file?.status === "copied") {
        return [...new Set([file.path, file.newPath].filter(isUsablePath))];
    }
    return diffFileAliases(file);
}
function isUsablePath(path) {
    return path !== undefined && path !== "" && path !== "/dev/null";
}
function identityAliases(file) {
    if (file.status === "copied") {
        return [...new Set([file.path, file.newPath].filter(isUsablePath))];
    }
    return diffFileAliases(file);
}
function filesShareIdentity(left, right) {
    const rightAliases = new Set(identityAliases(right));
    return identityAliases(left).some((path) => rightAliases.has(path));
}
function fileMatchesPaths(file, paths) {
    return diffFileAliases(file).some((path) => paths.has(path));
}
function countChangedLines(files) {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
        for (const line of file.lines) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
                additions += 1;
            }
            else if (line.startsWith("-") && !line.startsWith("---")) {
                deletions += 1;
            }
        }
    }
    return { additions, deletions };
}
function diffStats(files) {
    return { files: files.length, ...countChangedLines(files) };
}
export function createDiffSlice(scope, raw, files = parseDiff(raw), capture) {
    return {
        scope,
        raw,
        files,
        stats: diffStats(files),
        omittedFileCount: files.filter((file) => file.omission !== undefined).length,
        capturedPatchBytes: capture?.bytes ?? utf8Bytes(raw),
        capturedPatchLines: capture?.lines ?? textLineCount(raw),
    };
}
function placeholderFile(path, options) {
    const conflicted = options.conflicted === true;
    return {
        path,
        oldPath: options.untracked ? "/dev/null" : path,
        newPath: path,
        status: conflicted ? "conflicted" : "added",
        untracked: options.untracked || undefined,
        lines: conflicted ? [`diff --cc ${path}`, `Unmerged path: ${path}`] : [],
    };
}
function ensurePathFiles(files, paths, options) {
    for (const path of paths) {
        if (!files.some((file) => diffFileAliases(file).includes(path))) {
            files.push(placeholderFile(path, options));
        }
    }
}
function fileStageState(scope, mixed, conflicted) {
    if (conflicted) {
        return "conflicted";
    }
    if (mixed) {
        return "mixed";
    }
    return scope === "staged" ? "staged" : "unstaged";
}
function mergedAlias(current, path, matching) {
    if (!matching || (current && current !== path)) {
        return current;
    }
    return matching;
}
function decoratedFile(file, scope, otherFiles, conflictedPaths, untrackedPaths) {
    const conflicted = fileMatchesPaths(file, conflictedPaths);
    const matchingFile = otherFiles.find((other) => filesShareIdentity(file, other));
    const matchingOldPath = matchingFile?.status === "copied" ? undefined : matchingFile?.oldPath;
    return {
        ...file,
        oldPath: mergedAlias(file.oldPath, file.path, matchingOldPath),
        newPath: mergedAlias(file.newPath, file.path, matchingFile?.newPath),
        status: conflicted ? "conflicted" : file.status,
        stageState: fileStageState(scope, matchingFile !== undefined, conflicted),
        untracked: file.untracked || fileMatchesPaths(file, untrackedPaths) || undefined,
    };
}
export function buildWorkingTreeDocument(input) {
    const untrackedPaths = new Set(input.untrackedPaths);
    const conflictedPaths = new Set(input.conflictedPaths);
    const stagedFiles = [...parseDiff(input.stagedRaw), ...(input.stagedOmittedFiles ?? [])];
    const workingFiles = [...parseDiff(input.workingRaw), ...(input.workingOmittedFiles ?? [])];
    ensurePathFiles(workingFiles, untrackedPaths, { untracked: true });
    ensurePathFiles(workingFiles, conflictedPaths, { conflicted: true });
    ensurePathFiles(stagedFiles, conflictedPaths, { conflicted: true });
    const staged = stagedFiles.map((file) => decoratedFile(file, "staged", workingFiles, conflictedPaths, untrackedPaths));
    const working = workingFiles.map((file) => decoratedFile(file, "working", stagedFiles, conflictedPaths, untrackedPaths));
    const stagedSlice = createDiffSlice("staged", input.stagedRaw, staged, input.stagedCapture);
    const workingSlice = createDiffSlice("working", input.workingRaw, working, input.workingCapture);
    const raw = [stagedSlice.raw, workingSlice.raw].filter(Boolean).join("\n");
    const files = [...stagedSlice.files, ...workingSlice.files];
    return {
        mode: "working",
        title: input.title,
        subtitle: input.subtitle,
        repositoryState: input.repositoryState ?? "ready",
        headState: input.headState,
        raw,
        files,
        omittedFileCount: stagedSlice.omittedFileCount + workingSlice.omittedFileCount,
        capturedPatchBytes: stagedSlice.capturedPatchBytes + workingSlice.capturedPatchBytes,
        capturedPatchLines: stagedSlice.capturedPatchLines + workingSlice.capturedPatchLines,
        staged: stagedSlice,
        working: workingSlice,
        ...(input.revision === undefined ? {} : { revision: input.revision }),
    };
}
export function emptyWorkingTreeDocument(title, subtitle, repositoryState = "ready", headState = "unborn") {
    return buildWorkingTreeDocument({ title, subtitle, stagedRaw: "", workingRaw: "", repositoryState, headState });
}
export function buildCommitDocument(input) {
    const diff = createDiffSlice("commit", input.raw, [...parseDiff(input.raw), ...(input.omittedFiles ?? [])], input.capture);
    return {
        mode: "commit",
        title: input.title,
        subtitle: input.subtitle,
        repositoryState: "ready",
        headState: input.headState ?? "present",
        raw: diff.raw,
        files: diff.files,
        omittedFileCount: diff.omittedFileCount,
        capturedPatchBytes: diff.capturedPatchBytes,
        capturedPatchLines: diff.capturedPatchLines,
        commit: input.commit,
        diff,
    };
}
export function selectDiffSlice(document, view = "working") {
    return document.mode === "commit" ? document.diff : document[view];
}
export function workingTreeHasConflicts(document) {
    return [...document.staged.files, ...document.working.files].some((file) => file.stageState === "conflicted");
}
//# sourceMappingURL=diff-document.js.map