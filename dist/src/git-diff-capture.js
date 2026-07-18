import { DEFAULT_TRACKED_DIFF_BUDGET } from "./diff-budgets.js";
import { parseDiff } from "./diff-parser-core.js";
import { loadGitFileState, sameGitFileState } from "./git-file-state.js";
import { loadHeadPathSizes, loadIndexPathIdentity, loadIndexPathSizes, } from "./git-object-sizes.js";
import { splitGitPatch, textLineCount, utf8Bytes } from "./git-patch.js";
import { chunkLiteralPathGroups } from "./git-path-batches.js";
import { runGit, throwIfGitAborted } from "./git-service.js";
import { retainTrackedPatchChunks } from "./git-tracked-retention.js";
import { omittedTrackedGroup, selectTrackedGroups, trackedGroups, } from "./git-tracked-selection.js";
import { mapGitWorkers } from "./git-worker-pool.js";
const BASE_DIFF_ARGS = [
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "--find-renames",
    "--find-copies",
    "--color=never",
];
async function loadFileStates(root, paths, concurrency, signal) {
    const states = await mapGitWorkers(paths, concurrency, async (path, _index, workerSignal) => {
        throwIfGitAborted(workerSignal);
        const state = await loadGitFileState(root, path);
        throwIfGitAborted(workerSignal);
        return state;
    }, signal);
    return new Map(paths.map((path, index) => [path, states[index] ?? { kind: "missing" }]));
}
function cleanSnapshotProbeArgs(snapshot, scope) {
    if (scope === "working")
        return ["diff", "--quiet", "--"];
    if (scope === "staged") {
        return snapshot.head.kind === "initial"
            ? ["diff", "--cached", "--quiet", "--"]
            : ["diff", "--cached", "--quiet", snapshot.head.oid, "--"];
    }
    return snapshot.head.kind === "initial"
        ? ["diff", "--cached", "--quiet", "--"]
        : ["diff", "--quiet", snapshot.head.oid, "--"];
}
function workingTreeDiffArgs(snapshot, paths, scope) {
    const literal = paths ? ["--literal-pathspecs"] : [];
    const pathArgs = ["--", ...(paths ?? [])];
    if (scope === "working")
        return [...literal, ...BASE_DIFF_ARGS, ...pathArgs];
    if (scope === "staged") {
        const revision = snapshot.head.kind === "initial" ? [] : [snapshot.head.oid];
        return [...literal, ...BASE_DIFF_ARGS, "--cached", ...revision, ...pathArgs];
    }
    if (snapshot.head.kind !== "initial") {
        return [...literal, ...BASE_DIFF_ARGS, snapshot.head.oid, ...pathArgs];
    }
    return [...literal, ...BASE_DIFF_ARGS, "--cached", ...pathArgs];
}
function scopedSnapshot(snapshot, scope) {
    if (scope === "combined")
        return snapshot;
    const entries = snapshot.entries.filter((entry) => scope === "staged"
        ? entry.indexStatus !== "." || entry.kind === "unmerged"
        : entry.worktreeStatus !== "." || entry.kind === "unmerged");
    return {
        ...snapshot,
        entries,
        stagedPaths: scope === "staged" ? snapshot.stagedPaths : new Set(),
        untrackedPaths: [],
        clean: entries.length === 0,
    };
}
function changedGroups(selected, before, after) {
    const changed = new Set();
    for (const group of selected) {
        if (group.paths.some((path) => !sameGitFileState(before.get(path) ?? { kind: "missing" }, after.get(path) ?? { kind: "missing" }))) {
            changed.add(group.index);
        }
    }
    return changed;
}
function indexGroupsByPath(groups) {
    const indexes = new Map();
    for (const group of groups) {
        for (const path of group.paths) {
            const pathIndexes = indexes.get(path) ?? [];
            pathIndexes.push(group.index);
            indexes.set(path, pathIndexes);
        }
    }
    return indexes;
}
function groupIndexesForFile(file, groupsByPath) {
    const paths = [file.path, file.oldPath, file.newPath].filter((path) => path !== undefined);
    return [...new Set(paths.flatMap((path) => groupsByPath.get(path) ?? []))].sort((left, right) => left - right);
}
function patchChunks(raw, groupsByPath) {
    return splitGitPatch(raw).chunks.map((chunk) => {
        const file = parseDiff(chunk)[0] ?? { path: "(unknown)", status: "modified", staged: false, lines: [] };
        return {
            raw: chunk,
            file,
            groupIndexes: groupIndexesForFile(file, groupsByPath),
            bytes: utf8Bytes(chunk),
            lines: textLineCount(chunk),
        };
    });
}
function emptyTrackedCapture(omissions) {
    const omittedFiles = [...omissions.entries()].sort(([left], [right]) => left - right).map(([, file]) => file);
    return { raw: "", omittedFiles, capturedPatchBytes: 0, capturedPatchLines: 0 };
}
function recordArgumentOmissions(groups, snapshot, omissions) {
    for (const group of groups) {
        omissions.set(group.index, omittedTrackedGroup(group, snapshot, "capture-overflow", {
            detail: "The connected path group exceeds the configured Git argument limit.",
        }));
    }
}
function argumentEligibleGroups(groups, snapshot, budget, omissions, scope) {
    const chunks = chunkLiteralPathGroups(groups.map((group) => ({ value: group, paths: group.paths })), budget, workingTreeDiffArgs(snapshot, [], scope));
    recordArgumentOmissions(chunks.oversized, snapshot, omissions);
    return chunks.batches.flat();
}
async function prepareTrackedSelection(pi, root, snapshot, groups, budget, omissions, scope, signal) {
    const candidates = groups.slice(0, Math.max(0, budget.maxFiles));
    for (const group of groups.slice(candidates.length)) {
        omissions.set(group.index, omittedTrackedGroup(group, snapshot, "file-count-budget", { limitFiles: budget.maxFiles }));
    }
    const eligible = argumentEligibleGroups(candidates, snapshot, budget, omissions, scope);
    const paths = [...new Set(eligible.flatMap((group) => group.paths))];
    const headSizes = snapshot.head.kind === "initial"
        ? new Map()
        : await loadHeadPathSizes(pi, root, snapshot.head.oid, paths, budget, signal);
    const initialCombined = scope === "combined" && snapshot.head.kind === "initial";
    const indexSizes = scope === "combined" && !initialCombined ? undefined : await loadIndexPathSizes(pi, root, paths, budget, signal);
    const checkFileStates = scope !== "staged" && !initialCombined;
    const selectionScope = initialCombined ? "staged" : scope;
    const before = checkFileStates
        ? await loadFileStates(root, paths, budget.concurrency, signal)
        : new Map();
    const selected = selectTrackedGroups(eligible, snapshot, headSizes, before, indexSizes, selectionScope, budget, omissions, signal);
    return { selected, paths, indexSizes, checkFileStates, before };
}
async function indexMatches(pi, root, phase, budget, signal) {
    if (!phase.indexSizes)
        return true;
    const identity = await loadIndexPathIdentity(pi, root, phase.paths, budget, signal);
    return identity === phase.indexSizes.identity;
}
function recordChangedGroups(groups, snapshot, omissions) {
    for (const group of groups) {
        omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"));
    }
}
async function captureSelectedGroups(pi, root, snapshot, phase, budget, omissions, scope, signal) {
    const patchGroups = chunkLiteralPathGroups(phase.selected.map((group) => ({ value: group, paths: group.paths })), budget, workingTreeDiffArgs(snapshot, [], scope));
    recordArgumentOmissions(patchGroups.oversized, snapshot, omissions);
    const capturable = patchGroups.batches.flat();
    if (capturable.length === 0)
        return;
    if (!(await indexMatches(pi, root, phase, budget, signal))) {
        recordChangedGroups(capturable, snapshot, omissions);
        return;
    }
    const capturedParts = [];
    for (const batch of patchGroups.batches) {
        const batchPaths = [...new Set(batch.flatMap((group) => group.paths))];
        capturedParts.push((await runGit(pi, root, workingTreeDiffArgs(snapshot, batchPaths, scope), { signal })).stdout);
    }
    if (!(await indexMatches(pi, root, phase, budget, signal))) {
        recordChangedGroups(capturable, snapshot, omissions);
        return;
    }
    const selectedPaths = [...new Set(capturable.flatMap((group) => group.paths))];
    const after = phase.checkFileStates
        ? await loadFileStates(root, selectedPaths, budget.concurrency, signal)
        : phase.before;
    throwIfGitAborted(signal);
    return { raw: capturedParts.join(""), capturable, after };
}
function completeTrackedCapture(rawCapture, phase, patch, groups, snapshot, omissions, budget) {
    const changed = phase.checkFileStates ? changedGroups(patch.capturable, phase.before, patch.after) : new Set();
    const chunks = patchChunks(rawCapture, indexGroupsByPath(groups));
    const capturedGroups = new Set(chunks.flatMap((chunk) => chunk.groupIndexes));
    for (const group of patch.capturable) {
        if (changed.has(group.index)) {
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"));
        }
        else if (!capturedGroups.has(group.index)) {
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "unsupported-file", {
                detail: "Git produced no patch for this status entry; diff configuration may have suppressed it.",
            }));
        }
    }
    const raw = retainTrackedPatchChunks(rawCapture, chunks, groups, snapshot, changed, omissions, budget);
    const omittedFiles = [...omissions.entries()].sort(([left], [right]) => left - right).map(([, file]) => file);
    return {
        raw,
        omittedFiles,
        capturedPatchBytes: utf8Bytes(raw),
        capturedPatchLines: textLineCount(raw),
    };
}
export async function captureTrackedDiff(pi, root, snapshot, budget = DEFAULT_TRACKED_DIFF_BUDGET, signal, scope = "combined") {
    throwIfGitAborted(signal);
    const scoped = scopedSnapshot(snapshot, scope);
    const groups = trackedGroups(scoped);
    if (groups.length === 0) {
        await runGit(pi, root, cleanSnapshotProbeArgs(scoped, scope), { signal, acceptedExitCodes: [0, 1] });
        return { raw: "", omittedFiles: [], capturedPatchBytes: 0, capturedPatchLines: 0 };
    }
    const omissions = new Map();
    const selection = await prepareTrackedSelection(pi, root, scoped, groups, budget, omissions, scope, signal);
    if (selection.selected.length === 0)
        return emptyTrackedCapture(omissions);
    const patch = await captureSelectedGroups(pi, root, scoped, selection, budget, omissions, scope, signal);
    return patch
        ? completeTrackedCapture(patch.raw, selection, patch, groups, scoped, omissions, budget)
        : emptyTrackedCapture(omissions);
}
//# sourceMappingURL=git-diff-capture.js.map