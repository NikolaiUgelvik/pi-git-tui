import { commitOmission, loadBoundedStagedEntries, loadStagedEntries, } from "./commit-staged-snapshot.js";
import { DEFAULT_COMMIT_PROMPT_BUDGET } from "./diff-budgets.js";
import { parseDiff } from "./diff-parser-core.js";
import { buildDiffArgs, CANONICAL_PATCH_OPTIONS } from "./git-diff-args.js";
import { splitGitPatch, textLineCount } from "./git-patch.js";
import { chunkLiteralPathGroups } from "./git-path-batches.js";
import { ensureGitRepository, runGit, throwIfGitAborted } from "./git-service.js";
export { parseStagedRawDiff } from "./commit-staged-snapshot.js";
function stagedPatchArgs(paths) {
    return buildDiffArgs({
        options: ["--cached", "--stat", "--patch", ...CANONICAL_PATCH_OPTIONS],
        paths,
    });
}
function commitPatchChunks(raw, entries) {
    const entryByPath = new Map(entries.flatMap((entry) => entry.paths.map((path) => [path, entry.index])));
    return splitGitPatch(raw).chunks.map((chunk) => {
        const file = parseDiff(chunk)[0];
        const path = file?.path ?? "(unknown)";
        return {
            raw: chunk,
            path,
            entryIndex: entryByPath.get(path) ?? (file?.oldPath ? entryByPath.get(file.oldPath) : undefined),
            chars: chunk.length,
            lines: textLineCount(chunk),
        };
    });
}
function retainCommitPatch(chunks, entries, omissions, budget) {
    const totals = new Map();
    for (const [index, chunk] of chunks.entries()) {
        const key = chunk.entryIndex ?? -(index + 1);
        const total = totals.get(key) ?? { chars: 0, lines: 0 };
        total.chars += chunk.chars;
        total.lines += chunk.lines;
        totals.set(key, total);
    }
    const retained = new Set();
    let retainedChars = 0;
    let retainedLines = 0;
    let stopped;
    for (const [index, chunk] of chunks.entries()) {
        const key = chunk.entryIndex ?? -(index + 1);
        if (retained.has(key) || (key >= 0 && omissions.has(key)))
            continue;
        const total = totals.get(key) ?? { chars: chunk.chars, lines: chunk.lines };
        const entry = key >= 0 ? entries[key] : undefined;
        const path = entry?.path ?? chunk.path;
        const omissionIndex = key >= 0 ? key : entries.length + index;
        if (stopped === "chars") {
            omissions.set(key, commitOmission(omissionIndex, path, "capture-overflow", {
                detail: `The retained patch character budget was reached; the limit is ${budget.maxPatchChars}.`,
            }));
            continue;
        }
        if (stopped === "lines") {
            omissions.set(key, commitOmission(omissionIndex, path, "aggregate-line-budget", { limitLines: budget.maxPatchLines }));
            continue;
        }
        if (retainedChars + total.chars > budget.maxPatchChars) {
            stopped = "chars";
            omissions.set(key, commitOmission(omissionIndex, path, "capture-overflow", {
                detail: `Retaining this complete patch would use ${retainedChars + total.chars} characters; the retained patch limit is ${budget.maxPatchChars}.`,
            }));
            continue;
        }
        if (retainedLines + total.lines > budget.maxPatchLines) {
            stopped = "lines";
            omissions.set(key, commitOmission(omissionIndex, path, "aggregate-line-budget", {
                measuredLines: retainedLines + total.lines,
                limitLines: budget.maxPatchLines,
            }));
            continue;
        }
        retained.add(key);
        retainedChars += total.chars;
        retainedLines += total.lines;
    }
    return {
        patch: chunks
            .filter((chunk, index) => retained.has(chunk.entryIndex ?? -(index + 1)))
            .map((chunk) => chunk.raw)
            .join(""),
        includedFiles: retained.size,
    };
}
function wholeLinesWithin(text, maxChars) {
    if (text.length <= maxChars)
        return text.trimEnd();
    const lines = text.split(/(?<=\n)/u);
    const retained = [];
    let chars = 0;
    for (const line of lines) {
        if (chars + line.length > maxChars)
            break;
        retained.push(line);
        chars += line.length;
    }
    return retained.join("").trimEnd();
}
function omissionLines(omissions, maxChars) {
    if (omissions.length === 0 || maxChars <= 0)
        return "";
    const lines = [`Omitted staged files (${omissions.length}):`];
    let chars = lines[0]?.length ?? 0;
    let shown = 0;
    for (const item of omissions) {
        const line = `- ${JSON.stringify(item.path)}: ${item.omission.message}`;
        if (chars + 1 + line.length > maxChars)
            break;
        lines.push(line);
        chars += 1 + line.length;
        shown++;
    }
    if (shown < omissions.length) {
        const remaining = `- … ${omissions.length - shown} more omitted file(s)`;
        if (chars + 1 + remaining.length <= maxChars)
            lines.push(remaining);
    }
    return lines.join("\n");
}
function joinInputSections(sections) {
    return sections.filter(Boolean).join("\n\n");
}
function buildCommitInputText(stat, patch, includedFiles, omissions, budget) {
    const header = `Staged files: ${includedFiles} included, ${omissions.length} omitted.`;
    const reservedPatch = patch.length + (patch ? 2 : 0);
    const detailsBudget = Math.max(0, budget.maxInputChars - header.length - reservedPatch - 2);
    const details = omissionLines(omissions, detailsBudget);
    const usedByDetails = details ? details.length + 2 : 0;
    const statBudget = Math.max(0, Math.min(budget.maxStatChars, budget.maxInputChars - header.length - reservedPatch - usedByDetails - 2));
    const boundedStat = wholeLinesWithin(stat, statBudget);
    const text = joinInputSections([header, details, boundedStat, patch]);
    if (text.length > budget.maxInputChars) {
        throw new Error("Commit diff input exceeded its configured character budget");
    }
    return text;
}
const EMPTY_COMMIT_PATCH = { stat: "", patch: "", includedFiles: 0 };
function markCommitEntriesChanged(entries, omissions) {
    for (const entry of entries) {
        omissions.set(entry.index, commitOmission(entry.index, entry.path, "changed-during-load"));
    }
}
function recordOversizedCommitPaths(entries, omissions) {
    for (const entry of entries) {
        omissions.set(entry.index, commitOmission(entry.index, entry.path, "capture-overflow", {
            detail: "The connected path group exceeds the configured Git argument limit.",
        }));
    }
}
async function captureCommitPatchParts(pi, root, batches, signal) {
    const parts = [];
    for (const batch of batches) {
        const paths = [...new Set(batch.flatMap((entry) => entry.paths))];
        parts.push((await runGit(pi, root, stagedPatchArgs(paths), { signal })).stdout);
    }
    return parts;
}
function retainedCommitCapture(parts, entries, capturable, omissions, budget) {
    const capturedRaw = parts.join("");
    const chunks = commitPatchChunks(capturedRaw, entries);
    const capturedIndexes = new Set(chunks.flatMap((chunk) => (chunk.entryIndex === undefined ? [] : [chunk.entryIndex])));
    for (const entry of capturable) {
        if (!capturedIndexes.has(entry.index) && !omissions.has(entry.index)) {
            omissions.set(entry.index, commitOmission(entry.index, entry.path, "changed-during-load"));
        }
    }
    const retained = retainCommitPatch(chunks, entries, omissions, budget);
    return {
        stat: parts
            .map((part) => splitGitPatch(part).preamble)
            .filter(Boolean)
            .join("\n"),
        patch: retained.patch,
        includedFiles: retained.includedFiles,
    };
}
async function captureSelectedCommitPatch(pi, root, stagedRaw, entries, selected, omissions, budget, signal) {
    if (selected.length === 0)
        return EMPTY_COMMIT_PATCH;
    if ((await loadStagedEntries(pi, root, signal)).raw !== stagedRaw) {
        markCommitEntriesChanged(selected, omissions);
        return EMPTY_COMMIT_PATCH;
    }
    const patchGroups = chunkLiteralPathGroups(selected.map((entry) => ({ value: entry, paths: entry.paths })), budget, stagedPatchArgs([]));
    recordOversizedCommitPaths(patchGroups.oversized, omissions);
    const capturable = patchGroups.batches.flat();
    const parts = await captureCommitPatchParts(pi, root, patchGroups.batches, signal);
    if ((await loadStagedEntries(pi, root, signal)).raw !== stagedRaw) {
        markCommitEntriesChanged(capturable, omissions);
        return EMPTY_COMMIT_PATCH;
    }
    return retainedCommitCapture(parts, entries, capturable, omissions, budget);
}
export async function collectCommitDiffInput(pi, cwd, budget = DEFAULT_COMMIT_PROMPT_BUDGET, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    const staged = await loadStagedEntries(pi, root, signal);
    if (staged.entries.length === 0)
        throw new Error("No staged changes to summarize");
    const omissions = new Map();
    const selected = await loadBoundedStagedEntries(pi, root, staged.entries, budget, omissions, signal);
    const captured = await captureSelectedCommitPatch(pi, root, staged.raw, staged.entries, selected, omissions, budget, signal);
    const orderedOmissions = [...omissions.values()].sort((left, right) => left.index - right.index);
    const text = buildCommitInputText(captured.stat, captured.patch, captured.includedFiles, orderedOmissions, budget);
    throwIfGitAborted(signal);
    return {
        text,
        includedFiles: captured.includedFiles,
        omittedFiles: orderedOmissions.length,
        capturedPatchChars: captured.patch.length,
    };
}
//# sourceMappingURL=commit-diff-input.js.map