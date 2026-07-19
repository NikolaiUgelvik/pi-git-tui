import { alignIntralineLines, changedTokenIndices, tokenizeIntralineLine, } from "./diff-intraline-algorithm.js";
export const INTRALINE_LIMITS = Object.freeze({
    lineUtf16Units: 8_192,
    graphemesPerLine: 1_024,
    tokensPerLine: 256,
    rowsPerRun: 128,
    linesPerSide: 64,
    tokensPerRun: 4_096,
    lineAlignmentCellsPerRun: 4_225,
    tokenLcsCellsPerPair: 16_384,
    tokenLcsCellsPerRun: 65_536,
    changeRowsPerFile: 4_096,
    changeRunsPerFile: 256,
    tokensPerFile: 65_536,
    alignmentCellsPerFile: 65_536,
    tokenLcsCellsPerFile: 262_144,
});
function emptyPlan(length) {
    return { spansByRow: Object.freeze(Array(length).fill(undefined)) };
}
function isChangeRow(row) {
    return row.type === "addition" || row.type === "deletion";
}
function isConflictMarker(text) {
    return ["<<<<<<<", "|||||||", "=======", ">>>>>>>"].some((marker) => text.startsWith(marker));
}
function collectChangeBlocks(rows, textByRow) {
    const blocks = [];
    let current = [];
    let inHunk = false;
    const flush = () => {
        if (current.length > 0)
            blocks.push({ rowIndices: current });
        current = [];
    };
    for (const [index, row] of rows.entries()) {
        if (row.type === "hunk") {
            flush();
            inHunk = true;
            continue;
        }
        if (!inHunk || !isChangeRow(row) || isConflictMarker(textByRow[index] ?? "")) {
            flush();
            continue;
        }
        current.push(index);
    }
    flush();
    return blocks;
}
function canonicalSides(block, rows) {
    const oldRows = [];
    const newRows = [];
    let additionsStarted = false;
    for (const index of block.rowIndices) {
        const row = rows[index];
        if (row?.type === "deletion" && !additionsStarted)
            oldRows.push(index);
        else if (row?.type === "addition") {
            additionsStarted = true;
            newRows.push(index);
        }
        else
            return;
    }
    return oldRows.length > 0 && newRows.length > 0 ? { oldRows, newRows } : undefined;
}
function tokenizeRun(sides, textByRow) {
    if (sides.oldRows.length + sides.newRows.length > INTRALINE_LIMITS.rowsPerRun ||
        sides.oldRows.length > INTRALINE_LIMITS.linesPerSide ||
        sides.newRows.length > INTRALINE_LIMITS.linesPerSide) {
        return;
    }
    const tokenizeRows = (indices) => {
        const result = [];
        for (const index of indices) {
            const text = textByRow[index] ?? "";
            if (text.length > INTRALINE_LIMITS.lineUtf16Units)
                return;
            const tokenized = tokenizeIntralineLine(text, INTRALINE_LIMITS.graphemesPerLine, INTRALINE_LIMITS.tokensPerLine);
            if (!tokenized)
                return;
            result.push(tokenized);
        }
        return result;
    };
    const oldLines = tokenizeRows(sides.oldRows);
    const newLines = tokenizeRows(sides.newRows);
    if (!oldLines || !newLines)
        return;
    return { ...sides, oldLines, newLines };
}
function nonWhitespaceSpans(tokens, changedIndices) {
    const spans = [];
    for (const index of changedIndices) {
        const token = tokens[index];
        if (!token || token.whitespace)
            continue;
        const previous = spans.at(-1);
        if (previous?.end === token.start)
            spans[spans.length - 1] = { start: previous.start, end: token.end };
        else
            spans.push({ start: token.start, end: token.end });
    }
    return spans;
}
function allTokenIndices(tokens) {
    return Array.from({ length: tokens.length }, (_value, index) => index);
}
function setRowSpans(target, row, spans) {
    if (spans.length > 0)
        target[row] = spans;
}
function runTokenCount(run) {
    return [...run.oldLines, ...run.newLines].reduce((total, line) => total + line.tokens.length, 0);
}
function tokenLcsCells(run, alignment) {
    let cells = 0;
    for (const entry of alignment) {
        if (entry.oldIndex === undefined || entry.newIndex === undefined)
            continue;
        const pairCells = ((run.oldLines[entry.oldIndex]?.tokens.length ?? 0) + 1) *
            ((run.newLines[entry.newIndex]?.tokens.length ?? 0) + 1);
        if (pairCells > INTRALINE_LIMITS.tokenLcsCellsPerPair)
            return;
        cells += pairCells;
    }
    return cells;
}
function applyAlignmentEntry(spansByRow, run, entry) {
    const oldLine = entry.oldIndex === undefined ? undefined : run.oldLines[entry.oldIndex];
    const newLine = entry.newIndex === undefined ? undefined : run.newLines[entry.newIndex];
    if (oldLine && newLine) {
        const changes = changedTokenIndices(oldLine.tokens, newLine.tokens);
        setRowSpans(spansByRow, run.oldRows[entry.oldIndex], nonWhitespaceSpans(oldLine.tokens, changes.oldChanged));
        setRowSpans(spansByRow, run.newRows[entry.newIndex], nonWhitespaceSpans(newLine.tokens, changes.newChanged));
    }
    else if (oldLine) {
        setRowSpans(spansByRow, run.oldRows[entry.oldIndex], nonWhitespaceSpans(oldLine.tokens, allTokenIndices(oldLine.tokens)));
    }
    else if (newLine) {
        setRowSpans(spansByRow, run.newRows[entry.newIndex], nonWhitespaceSpans(newLine.tokens, allTokenIndices(newLine.tokens)));
    }
}
function planBlock(block, rows, textByRow, spansByRow, budget) {
    const sides = canonicalSides(block, rows);
    if (!sides)
        return;
    const run = tokenizeRun(sides, textByRow);
    if (!run)
        return;
    const tokens = runTokenCount(run);
    budget.tokens += tokens;
    if (budget.tokens > INTRALINE_LIMITS.tokensPerFile)
        return "file-limit";
    if (tokens > INTRALINE_LIMITS.tokensPerRun)
        return;
    const alignmentCells = (run.oldLines.length + 1) * (run.newLines.length + 1);
    budget.alignmentCells += alignmentCells;
    if (budget.alignmentCells > INTRALINE_LIMITS.alignmentCellsPerFile)
        return "file-limit";
    if (alignmentCells > INTRALINE_LIMITS.lineAlignmentCellsPerRun)
        return;
    const alignment = alignIntralineLines(run.oldLines, run.newLines);
    const lcsCells = tokenLcsCells(run, alignment);
    if (lcsCells === undefined)
        return;
    budget.tokenLcsCells += lcsCells;
    if (budget.tokenLcsCells > INTRALINE_LIMITS.tokenLcsCellsPerFile)
        return "file-limit";
    if (lcsCells > INTRALINE_LIMITS.tokenLcsCellsPerRun)
        return;
    for (const entry of alignment)
        applyAlignmentEntry(spansByRow, run, entry);
}
function freezeSpans(spansByRow) {
    return {
        spansByRow: Object.freeze(spansByRow.map((spans) => (spans ? Object.freeze(spans.map((span) => Object.freeze(span))) : undefined))),
    };
}
export function planIntralineChanges(rows, normalizedTextByRow) {
    if (rows.length !== normalizedTextByRow.length)
        return emptyPlan(rows.length);
    if (rows.filter(isChangeRow).length > INTRALINE_LIMITS.changeRowsPerFile)
        return emptyPlan(rows.length);
    const blocks = collectChangeBlocks(rows, normalizedTextByRow);
    if (blocks.length > INTRALINE_LIMITS.changeRunsPerFile)
        return emptyPlan(rows.length);
    const spansByRow = Array(rows.length).fill(undefined);
    const budget = { tokens: 0, alignmentCells: 0, tokenLcsCells: 0 };
    for (const block of blocks) {
        if (planBlock(block, rows, normalizedTextByRow, spansByRow, budget) === "file-limit") {
            return emptyPlan(rows.length);
        }
    }
    return freezeSpans(spansByRow);
}
//# sourceMappingURL=diff-intraline.js.map