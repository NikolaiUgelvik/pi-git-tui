import { SUBMODULE_SOURCE_BYTES } from "./diff-budgets.js";
import { omittedDiffFile } from "./diff-omission.js";
import { throwIfGitAborted } from "./git-service.js";
function uniquePaths(entry) {
    return [...new Set([entry.originalPath, entry.path].filter((path) => path !== undefined))];
}
export function trackedGroups(snapshot) {
    return snapshot.entries.map((entry, index) => ({ index, entry, paths: uniquePaths(entry) }));
}
function statusForEntry(entry) {
    if (entry.kind === "unmerged")
        return "conflicted";
    if (entry.similarity?.kind === "rename")
        return "renamed";
    if (entry.similarity?.kind === "copy")
        return "copied";
    const statuses = `${entry.indexStatus}${entry.worktreeStatus}`;
    if (statuses.includes("A"))
        return "added";
    if (statuses.includes("D"))
        return "deleted";
    if (statuses.includes("R"))
        return "renamed";
    if (statuses.includes("C"))
        return "copied";
    return "modified";
}
export function omittedTrackedGroup(group, snapshot, reason, details = {}) {
    return omittedDiffFile({
        path: group.entry.path,
        reason,
        status: statusForEntry(group.entry),
        staged: snapshot.stagedPaths.has(group.entry.path),
        ...(group.entry.originalPath === undefined ? {} : { oldPath: group.entry.originalPath }),
        ...(group.entry.kind === "rename" ? { newPath: group.entry.path } : {}),
        ...(group.entry.submodule.startsWith("S") ? { submodule: group.entry.submodule } : {}),
        ...details,
    });
}
function measurementFromSizes(sizes) {
    return {
        totalBytes: sizes.reduce((total, bytes) => total + bytes, 0),
        maxFileBytes: Math.max(0, ...sizes),
    };
}
function indexSourceBytes(group, indexSizes) {
    if (indexSizes.changedPaths.has(group.entry.path) || !indexSizes.sizes.has(group.entry.path)) {
        return { totalBytes: 0, maxFileBytes: 0, changed: true };
    }
    return measurementFromSizes(group.paths.map((path) => indexSizes.sizes.get(path) ?? 0));
}
function worktreeSourceBytes(group, headSizes, states) {
    const sizes = [];
    let unsupported;
    for (const path of group.paths) {
        const headBytes = headSizes.get(path);
        const state = states.get(path);
        if (state?.kind === "unsupported" && headBytes === undefined) {
            unsupported ??= state.description;
            continue;
        }
        sizes.push(Math.max(headBytes ?? 0, state?.kind === "file" ? state.bytes : 0));
    }
    return { ...measurementFromSizes(sizes), ...(unsupported === undefined ? {} : { unsupported }) };
}
function sourceBytes(group, headSizes, states, indexSizes) {
    if (indexSizes)
        return indexSourceBytes(group, indexSizes);
    if (group.entry.submodule.startsWith("S")) {
        return { totalBytes: SUBMODULE_SOURCE_BYTES, maxFileBytes: SUBMODULE_SOURCE_BYTES };
    }
    return worktreeSourceBytes(group, headSizes, states);
}
function recordStoppedOmission(group, snapshot, stopped, budget, omissions) {
    const reason = stopped === "count" ? "file-count-budget" : "aggregate-byte-budget";
    omissions.set(group.index, omittedTrackedGroup(group, snapshot, reason, {
        ...(stopped === "count" ? { limitFiles: budget.maxFiles } : { limitBytes: budget.maxTotalBytes }),
    }));
}
export function selectTrackedGroups(groups, snapshot, headSizes, states, indexSizes, budget, omissions, signal) {
    const selected = [];
    let selectedBytes = 0;
    let stopped;
    for (const group of groups) {
        throwIfGitAborted(signal);
        const source = sourceBytes(group, headSizes, states, indexSizes);
        if (source.changed) {
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "changed-during-load"));
        }
        else if (source.unsupported) {
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "unsupported-file", { detail: source.unsupported }));
        }
        else if (source.maxFileBytes > budget.maxFileBytes) {
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "file-too-large", {
                measuredBytes: source.maxFileBytes,
                limitBytes: budget.maxFileBytes,
            }));
        }
        else if (stopped || selected.length >= budget.maxFiles) {
            stopped ??= "count";
            recordStoppedOmission(group, snapshot, stopped, budget, omissions);
        }
        else if (selectedBytes + source.totalBytes > budget.maxTotalBytes) {
            stopped = "bytes";
            omissions.set(group.index, omittedTrackedGroup(group, snapshot, "aggregate-byte-budget", {
                measuredBytes: selectedBytes + source.totalBytes,
                limitBytes: budget.maxTotalBytes,
            }));
        }
        else {
            selectedBytes += source.totalBytes;
            selected.push({ ...group, sourceBytes: source.totalBytes });
        }
    }
    return selected;
}
//# sourceMappingURL=git-tracked-selection.js.map