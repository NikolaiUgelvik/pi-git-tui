import { relativeIntralineChanges } from "./diff-intraline-algorithm.js";
export const INTRALINE_LIMITS = Object.freeze({
    lineUtf16Units: 1_024,
    graphemesPerLine: 1_024,
    rowsPerRun: 128,
    linesPerSide: 64,
    changeRowsPerFile: 4_096,
    changeRunsPerFile: 256,
    graphemesPerFile: 65_536,
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
function positionalSides(block, rows) {
    if (block.rowIndices.length > INTRALINE_LIMITS.rowsPerRun)
        return;
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
    if (oldRows.length === 0 || oldRows.length !== newRows.length || oldRows.length > INTRALINE_LIMITS.linesPerSide) {
        return;
    }
    return { oldRows, newRows };
}
function setRange(target, row, range) {
    if (range)
        target[row] = [range];
}
function planBlock(block, rows, textByRow, spansByRow, graphemesUsed) {
    const sides = positionalSides(block, rows);
    if (!sides)
        return;
    for (const [pairIndex, oldRow] of sides.oldRows.entries()) {
        const newRow = sides.newRows[pairIndex];
        const oldText = textByRow[oldRow] ?? "";
        const newText = textByRow[newRow] ?? "";
        if (oldText.length > INTRALINE_LIMITS.lineUtf16Units || newText.length > INTRALINE_LIMITS.lineUtf16Units)
            continue;
        const changes = relativeIntralineChanges(oldText, newText, INTRALINE_LIMITS.graphemesPerLine);
        if (!changes)
            continue;
        graphemesUsed.value += changes.graphemeCount;
        if (graphemesUsed.value > INTRALINE_LIMITS.graphemesPerFile)
            return "file-limit";
        setRange(spansByRow, oldRow, changes.oldRange);
        setRange(spansByRow, newRow, changes.newRange);
    }
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
    const graphemesUsed = { value: 0 };
    for (const block of blocks) {
        if (planBlock(block, rows, normalizedTextByRow, spansByRow, graphemesUsed) === "file-limit") {
            return emptyPlan(rows.length);
        }
    }
    return freezeSpans(spansByRow);
}
//# sourceMappingURL=diff-intraline.js.map