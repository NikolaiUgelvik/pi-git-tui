import { formatDiffDisplay } from "./diff-display.js";
import { buildTreeRows } from "./tree.js";
export const MAX_RETAINED_DIFF_ROWS = 50_000;
export const MAX_RETAINED_DIFF_WEIGHT_BYTES = 8 * 1024 * 1024;
function immutableRows(rows) {
    for (const row of rows) {
        Object.freeze(row);
    }
    return Object.freeze(rows);
}
function isNumberedDiffRow(row) {
    return row.type === "context" || row.type === "addition" || row.type === "deletion";
}
function displayRowWeight(row) {
    const text = "text" in row ? row.text : (row.sectionText ?? "");
    return 128 + Buffer.byteLength(text, "utf8");
}
function displayWeight(rows) {
    return rows.reduce((total, row) => total + displayRowWeight(row), 0);
}
export function diffDisplayGutterWidth(rows) {
    return rows.reduce((width, row) => {
        if (!isNumberedDiffRow(row)) {
            return width;
        }
        return Math.max(width, String(row.lineNumber).length);
    }, 0);
}
/**
 * Holds one document generation of viewer derivations.
 *
 * Diff documents are treated as immutable between replaceDocument() calls.
 * Each replacement or explicit invalidation advances the version and drops the
 * row/byte-bounded selected-file LRU and tree snapshot, so historical documents
 * cannot accumulate in the cache.
 */
export class ViewerRenderCache {
    files;
    documentVersion = 0;
    selectedFileDisplayAccesses = 0;
    selectedFileDisplayHits = 0;
    selectedFileDisplayMisses = 0;
    selectedFileDisplayBuilds = 0;
    selectedFileDisplaySkips = 0;
    treeBuilds = 0;
    selectedFileDisplaySnapshots = new Map();
    retainedDisplayRows = 0;
    retainedDisplayWeightBytes = 0;
    treeSnapshotValue;
    constructor(files) {
        this.files = files;
    }
    replaceDocument(files) {
        if (files === this.files)
            return;
        this.files = files;
        this.invalidate();
    }
    invalidate() {
        this.documentVersion++;
        this.selectedFileDisplaySnapshots.clear();
        this.retainedDisplayRows = 0;
        this.retainedDisplayWeightBytes = 0;
        this.treeSnapshotValue = undefined;
    }
    selectedFileDisplay(fileIndex) {
        const file = this.files[fileIndex];
        if (!file) {
            return;
        }
        this.selectedFileDisplayAccesses++;
        const cached = this.selectedFileDisplaySnapshots.get(fileIndex);
        if (cached?.documentVersion === this.documentVersion) {
            this.selectedFileDisplayHits++;
            this.selectedFileDisplaySnapshots.delete(fileIndex);
            this.selectedFileDisplaySnapshots.set(fileIndex, cached);
            return cached;
        }
        this.selectedFileDisplayMisses++;
        const formattedRows = formatDiffDisplay(file);
        const weightBytes = displayWeight(formattedRows);
        const retain = formattedRows.length <= MAX_RETAINED_DIFF_ROWS && weightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES;
        const rows = retain ? immutableRows(formattedRows) : formattedRows;
        const snapshot = Object.freeze({
            documentVersion: this.documentVersion,
            fileIndex,
            rows,
            gutterWidth: diffDisplayGutterWidth(rows),
            weightBytes,
        });
        this.selectedFileDisplayBuilds++;
        if (retain)
            this.retainSelectedFileDisplay(snapshot);
        else
            this.selectedFileDisplaySkips++;
        return snapshot;
    }
    treeRows() {
        return this.treeSnapshot().rows;
    }
    treeFileOrder() {
        return this.treeSnapshot().fileOrder;
    }
    treeFileOrderIndex(fileIndex) {
        return this.treeSnapshot().fileOrderIndex.get(fileIndex);
    }
    treeRowIndex(fileIndex) {
        return this.treeSnapshot().rowIndex.get(fileIndex);
    }
    fileIndexForPath(path) {
        return this.treeSnapshot().fileIndexByPath.get(path);
    }
    stats() {
        return {
            documentVersion: this.documentVersion,
            selectedFileDisplayAccesses: this.selectedFileDisplayAccesses,
            selectedFileDisplayHits: this.selectedFileDisplayHits,
            selectedFileDisplayMisses: this.selectedFileDisplayMisses,
            selectedFileDisplayBuilds: this.selectedFileDisplayBuilds,
            selectedFileDisplaySkips: this.selectedFileDisplaySkips,
            retainedSelectedFileRows: this.retainedDisplayRows,
            retainedSelectedFileWeightBytes: this.retainedDisplayWeightBytes,
            treeBuilds: this.treeBuilds,
        };
    }
    retainSelectedFileDisplay(snapshot) {
        while (this.selectedFileDisplaySnapshots.size > 0 &&
            (this.retainedDisplayRows + snapshot.rows.length > MAX_RETAINED_DIFF_ROWS ||
                this.retainedDisplayWeightBytes + snapshot.weightBytes > MAX_RETAINED_DIFF_WEIGHT_BYTES)) {
            const oldestIndex = this.selectedFileDisplaySnapshots.keys().next().value;
            if (oldestIndex === undefined)
                break;
            const oldest = this.selectedFileDisplaySnapshots.get(oldestIndex);
            this.selectedFileDisplaySnapshots.delete(oldestIndex);
            this.retainedDisplayRows -= oldest?.rows.length ?? 0;
            this.retainedDisplayWeightBytes -= oldest?.weightBytes ?? 0;
        }
        this.selectedFileDisplaySnapshots.set(snapshot.fileIndex, snapshot);
        this.retainedDisplayRows += snapshot.rows.length;
        this.retainedDisplayWeightBytes += snapshot.weightBytes;
    }
    treeSnapshot() {
        const cached = this.treeSnapshotValue;
        if (cached?.documentVersion === this.documentVersion) {
            return cached;
        }
        const rows = immutableRows(buildTreeRows([...this.files]));
        const fileOrder = [];
        const fileOrderIndex = new Map();
        const rowIndex = new Map();
        const fileIndexByPath = new Map();
        for (const [index, file] of this.files.entries()) {
            if (!fileIndexByPath.has(file.path)) {
                fileIndexByPath.set(file.path, index);
            }
        }
        for (const [index, row] of rows.entries()) {
            if (row.fileIndex === undefined) {
                continue;
            }
            rowIndex.set(row.fileIndex, index);
            fileOrderIndex.set(row.fileIndex, fileOrder.length);
            fileOrder.push(row.fileIndex);
        }
        const snapshot = {
            documentVersion: this.documentVersion,
            rows,
            fileOrder: Object.freeze(fileOrder),
            fileOrderIndex,
            rowIndex,
            fileIndexByPath,
        };
        this.treeSnapshotValue = snapshot;
        this.treeBuilds++;
        return snapshot;
    }
}
//# sourceMappingURL=viewer-render-cache.js.map