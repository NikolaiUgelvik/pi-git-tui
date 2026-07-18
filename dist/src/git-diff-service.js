import { buildDocument, emptyDocument } from "./diff-parser.js";
import { captureTrackedDiff } from "./git-diff-capture.js";
import { captureHistoricalDiff } from "./git-historical-diff-capture.js";
import { textLineCount, utf8Bytes } from "./git-patch.js";
import { ensureGitRepository, hasHeadCommit, runGit, throwIfGitAborted } from "./git-service.js";
import { loadWorkingTreeSnapshot, workingTreeBranchLabel } from "./git-status.js";
import { loadUntrackedDiffs } from "./git-untracked-service.js";
import { linkedAbortController } from "./git-worker-pool.js";
import { workingTreeContentIdentity } from "./git-working-tree-identity.js";
async function currentBranchLabel(pi, cwd, signal) {
    const branchResult = await runGit(pi, cwd, ["branch", "--show-current"], { signal });
    const branch = branchResult.stdout.trim();
    if (branch) {
        return branch;
    }
    if (!(await hasHeadCommit(pi, cwd, signal)))
        return;
    const headResult = await runGit(pi, cwd, ["rev-parse", "--short", "HEAD"], { signal });
    const head = headResult.stdout.trim();
    if (!head)
        throw new Error("Git returned an empty HEAD abbreviation");
    return `detached ${head}`;
}
function repositoryLabel(root, branch) {
    return branch ? `${root} (${branch})` : root;
}
export function workingTreeDocumentTitle(snapshot) {
    return snapshot.head.kind === "initial" ? "Working tree (no commits yet)" : "Working tree vs HEAD";
}
export function workingTreeDocumentSubtitle(root, snapshot) {
    return repositoryLabel(root, workingTreeBranchLabel(snapshot));
}
export function workingTreeRevision(root, snapshot, contentIdentity) {
    return { root, statusFingerprint: snapshot.statusFingerprint, contentIdentity, clean: snapshot.clean };
}
function commitSubtitle(root, branch, message) {
    const repo = repositoryLabel(root, branch);
    return message ? `${repo} • ${message}` : repo;
}
function joinDiffParts(parts) {
    return parts.filter((part) => part.length > 0).join("\n");
}
function untrackedRole(snapshot, path) {
    if (snapshot.entries.some((entry) => entry.path === path && entry.indexStatus === "D")) {
        return "replacement";
    }
    if (snapshot.entries.some((entry) => entry.originalPath === path)) {
        return "rename-source";
    }
}
function untrackedFile(result, role) {
    const state = { staged: false, untracked: true, ...(role === undefined ? {} : { untrackedRole: role }) };
    if (result.kind === "omitted") {
        return [
            {
                path: result.path,
                status: "added",
                ...state,
                lines: [],
                omission: result.omission,
            },
        ];
    }
    if (!result.raw) {
        return [{ path: result.path, status: "added", ...state, lines: [] }];
    }
    const parsed = buildDocument("working", "", "", result.raw, undefined, new Set(), new Set(), new Set([result.path])).files;
    if (parsed.length === 1 && parsed[0]) {
        return [{ ...parsed[0], path: result.path, ...state }];
    }
    return parsed.length > 0
        ? parsed.map((file) => ({ ...file, ...state }))
        : [{ path: result.path, status: "added", ...state, lines: [] }];
}
function trackedFileOrder(file, snapshot) {
    const paths = new Set([file.path, file.oldPath, file.newPath].filter((path) => path !== undefined));
    const index = snapshot.entries.findIndex((entry) => paths.has(entry.path) || (entry.originalPath !== undefined && paths.has(entry.originalPath)));
    return index < 0 ? snapshot.entries.length : index;
}
function orderTrackedFiles(snapshot, captured, omitted) {
    return [...captured, ...omitted]
        .map((file, sequence) => ({ file, sequence, order: trackedFileOrder(file, snapshot) }))
        .sort((left, right) => left.order - right.order || left.sequence - right.sequence)
        .map(({ file }) => file);
}
function trackedFileMetadata(file, snapshot) {
    const entry = snapshot.entries.find((candidate) => candidate.path === file.path ||
        candidate.originalPath === file.path ||
        (file.oldPath !== undefined && candidate.originalPath === file.oldPath));
    return entry?.submodule.startsWith("S") ? { ...file, submodule: entry.submodule } : file;
}
function workingTreeDocument(root, snapshot, tracked, untracked, contentIdentity) {
    const title = workingTreeDocumentTitle(snapshot);
    const untrackedPatches = untracked.flatMap((result) => (result.kind === "patch" ? [result.raw] : []));
    const raw = joinDiffParts([tracked.raw, ...untrackedPatches]);
    const parsed = buildDocument("working", title, workingTreeDocumentSubtitle(root, snapshot), tracked.raw, undefined, snapshot.stagedPaths, snapshot.conflictedPaths);
    const trackedFiles = orderTrackedFiles(snapshot, parsed.files, tracked.omittedFiles).map((file) => trackedFileMetadata(file, snapshot));
    const files = [
        ...trackedFiles,
        ...untracked.flatMap((result) => untrackedFile(result, untrackedRole(snapshot, result.path))),
    ];
    return {
        ...parsed,
        raw,
        files,
        omittedFileCount: files.filter((file) => file.omission !== undefined).length,
        capturedPatchBytes: utf8Bytes(raw),
        capturedPatchLines: textLineCount(raw),
        revision: workingTreeRevision(root, snapshot, contentIdentity),
    };
}
export async function loadWorkingTreeDiffFromSnapshot(pi, root, snapshot, signal) {
    throwIfGitAborted(signal);
    const tracked = await captureTrackedDiff(pi, root, snapshot, undefined, signal);
    throwIfGitAborted(signal);
    const untracked = await loadUntrackedDiffs(pi, root, snapshot, undefined, signal);
    throwIfGitAborted(signal);
    const contentIdentity = await workingTreeContentIdentity(root, snapshot, signal);
    throwIfGitAborted(signal);
    return workingTreeDocument(root, snapshot, tracked, untracked, contentIdentity);
}
export async function loadWorkingTreeDiff(pi, ctx) {
    const linked = linkedAbortController(ctx.signal);
    const signal = linked.controller.signal;
    try {
        const root = await ensureGitRepository(pi, ctx.cwd, signal);
        if (!root) {
            return emptyDocument("Not a git repository", ctx.cwd, "working", undefined, "missing");
        }
        throwIfGitAborted(signal);
        const snapshot = await loadWorkingTreeSnapshot(pi, root, signal);
        return await loadWorkingTreeDiffFromSnapshot(pi, root, snapshot, signal);
    }
    finally {
        linked.dispose();
    }
}
export async function loadCommitDiff(pi, cwd, commit, signal) {
    const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd;
    const capture = await captureHistoricalDiff(pi, root, commit.hash, undefined, signal);
    const branch = await currentBranchLabel(pi, root, signal);
    const parsed = buildDocument("commit", `Commit ${commit.hash}`, commitSubtitle(root, branch, commit.message), capture.raw, commit);
    const files = [...parsed.files, ...capture.omittedFiles].sort((left, right) => left.path.localeCompare(right.path));
    return {
        ...parsed,
        files,
        omittedFileCount: capture.omittedFileCount,
        capturedPatchBytes: capture.capturedPatchBytes,
        capturedPatchLines: capture.capturedPatchLines,
    };
}
//# sourceMappingURL=git-diff-service.js.map