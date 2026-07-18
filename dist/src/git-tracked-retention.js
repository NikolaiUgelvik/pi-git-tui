import { omittedDiffFile } from "./diff-omission.js";
import { textLineCount, utf8Bytes } from "./git-patch.js";
import { omittedTrackedGroup } from "./git-tracked-selection.js";
function chunkKeys(chunks, groupCount) {
    return chunks.map((chunk, index) => chunk.groupIndexes[0] ?? groupCount + index);
}
function totalsByKey(chunks, keys) {
    const totals = new Map();
    chunks.forEach((chunk, index) => {
        const key = keys[index];
        if (key === undefined)
            return;
        const total = totals.get(key) ?? { bytes: 0, lines: 0 };
        total.bytes += chunk.bytes;
        total.lines += chunk.lines;
        totals.set(key, total);
    });
    return totals;
}
function omissionDecision(state, total, changed, budget) {
    if (changed)
        return { reason: "changed-during-load", details: {} };
    if (state.stopped === "bytes")
        return { reason: "capture-overflow", details: { limitBytes: budget.maxPatchBytes } };
    if (state.stopped === "lines") {
        return { reason: "aggregate-line-budget", details: { limitLines: budget.maxPatchLines } };
    }
    if (state.bytes + total.bytes > budget.maxPatchBytes) {
        state.stopped = "bytes";
        return {
            reason: "capture-overflow",
            details: { measuredBytes: state.bytes + total.bytes, limitBytes: budget.maxPatchBytes },
        };
    }
    if (state.lines + total.lines > budget.maxPatchLines) {
        state.stopped = "lines";
        return {
            reason: "aggregate-line-budget",
            details: { measuredLines: state.lines + total.lines, limitLines: budget.maxPatchLines },
        };
    }
}
function omittedChunk(chunk, snapshot, decision) {
    return omittedDiffFile({
        path: chunk.file.path,
        reason: decision.reason,
        status: chunk.file.status,
        staged: snapshot.stagedPaths.has(chunk.file.path),
        ...(chunk.file.oldPath === undefined ? {} : { oldPath: chunk.file.oldPath }),
        ...(chunk.file.newPath === undefined ? {} : { newPath: chunk.file.newPath }),
        ...decision.details,
    });
}
function recordDecision(key, chunk, group, snapshot, decision, omissions) {
    const file = group
        ? omittedTrackedGroup(group, snapshot, decision.reason, decision.details)
        : omittedChunk(chunk, snapshot, decision);
    omissions.set(key, file);
}
function retainKnownChunks(chunks, keys, groups, snapshot, changed, omissions, budget) {
    const totals = totalsByKey(chunks, keys);
    const state = { retained: new Set(), bytes: 0, lines: 0 };
    chunks.forEach((chunk, index) => {
        const key = keys[index];
        if (key === undefined || state.retained.has(key) || omissions.has(key))
            return;
        const group = groups[chunk.groupIndexes[0] ?? -1];
        const total = totals.get(key) ?? { bytes: chunk.bytes, lines: chunk.lines };
        const decision = omissionDecision(state, total, chunk.groupIndexes.some((groupIndex) => changed.has(groupIndex)), budget);
        if (decision)
            recordDecision(key, chunk, group, snapshot, decision, omissions);
        else {
            state.retained.add(key);
            state.bytes += total.bytes;
            state.lines += total.lines;
        }
    });
    return chunks
        .filter((_chunk, index) => state.retained.has(keys[index] ?? groups.length + index))
        .map((chunk) => chunk.raw)
        .join("");
}
function retainUnparsedOutput(raw, groups, snapshot, omissions, budget) {
    if (utf8Bytes(raw) <= budget.maxPatchBytes && textLineCount(raw) <= budget.maxPatchLines)
        return raw;
    for (const group of groups) {
        if (omissions.has(group.index))
            continue;
        omissions.set(group.index, omittedTrackedGroup(group, snapshot, "capture-overflow", {
            measuredBytes: utf8Bytes(raw),
            limitBytes: budget.maxPatchBytes,
        }));
    }
    return "";
}
export function retainTrackedPatchChunks(raw, chunks, groups, snapshot, changed, omissions, budget) {
    if (chunks.length === 0)
        return retainUnparsedOutput(raw, groups, snapshot, omissions, budget);
    return retainKnownChunks(chunks, chunkKeys(chunks, groups.length), groups, snapshot, changed, omissions, budget);
}
//# sourceMappingURL=git-tracked-retention.js.map