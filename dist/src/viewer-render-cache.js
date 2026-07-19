import { buildTreeRows } from "./tree.js";
export const MAX_RETAINED_DIFF_ROWS = 50_000;
export const MAX_RETAINED_DIFF_WEIGHT_BYTES = 8 * 1024 * 1024;
export const MAX_CURRENT_DIFF_ROWS = 100_000;
export const MAX_CURRENT_DIFF_WEIGHT_BYTES = 64 * 1024 * 1024;
function immutableRows(rows) {
    for (const row of rows)
        Object.freeze(row);
    return Object.freeze(rows);
}
function isNumberedDiffRow(row) {
    return row.type === "context" || row.type === "addition" || row.type === "deletion";
}
export function diffDisplayGutterWidth(rows) {
    return rows.reduce((width, row) => {
        if (!isNumberedDiffRow(row))
            return width;
        return Math.max(width, String(row.lineNumber).length);
    }, 0);
}
/** Holds bounded presentation and tree derivations for one immutable document reference. */
export class ViewerRenderCache {
    files;
    presenter;
    documentVersion = 0;
    presentationGeneration = 0;
    selectedFileDisplayAccesses = 0;
    selectedFileDisplayHits = 0;
    selectedFileDisplayMisses = 0;
    selectedFileDisplayBuilds = 0;
    selectedFileDisplaySkips = 0;
    selectedFileDisplayPins = 0;
    richSelectedFileDisplayBuilds = 0;
    plainSelectedFileDisplayBuilds = 0;
    syntaxHighlighterCalls = 0;
    themeInvalidations = 0;
    treeBuilds = 0;
    selectedFileDisplaySnapshots = new Map();
    retainedDisplayRows = 0;
    retainedDisplayWeightBytes = 0;
    currentDisplay;
    treeSnapshotValue;
    constructor(files, presenter) {
        this.files = files;
        this.presenter = presenter;
    }
    replaceDocument(files) {
        if (files === this.files)
            return;
        this.files = files;
        this.documentVersion++;
        this.clearPresentations();
        this.treeSnapshotValue = undefined;
    }
    invalidate() {
        this.documentVersion++;
        this.clearPresentations();
        this.treeSnapshotValue = undefined;
    }
    invalidatePresentation() {
        this.presentationGeneration++;
        this.themeInvalidations++;
        this.clearPresentations();
    }
    selectedFileDisplay(fileIndex) {
        const file = this.files[fileIndex];
        if (!file)
            return;
        this.selectedFileDisplayAccesses++;
        if (this.currentDisplay && this.currentDisplay.fileIndex !== fileIndex)
            this.currentDisplay = undefined;
        const current = this.currentDisplay;
        if (this.isCurrent(current, fileIndex)) {
            this.selectedFileDisplayHits++;
            return current;
        }
        const cached = this.selectedFileDisplaySnapshots.get(fileIndex);
        if (this.isCurrent(cached, fileIndex)) {
            this.selectedFileDisplayHits++;
            this.selectedFileDisplaySnapshots.delete(fileIndex);
            this.selectedFileDisplaySnapshots.set(fileIndex, cached);
            return cached;
        }
        this.selectedFileDisplayMisses++;
        const presentation = this.presenter(file);
        const snapshot = Object.freeze({
            ...presentation,
            documentVersion: this.documentVersion,
            presentationGeneration: this.presentationGeneration,
            fileIndex,
        });
        this.selectedFileDisplayBuilds++;
        this.syntaxHighlighterCalls += presentation.highlighterCalls;
        if (presentation.mode === "rich")
            this.richSelectedFileDisplayBuilds++;
        else
            this.plainSelectedFileDisplayBuilds++;
        if (this.fitsNormalTier(snapshot))
            this.retainSelectedFileDisplay(snapshot);
        else {
            this.selectedFileDisplaySkips++;
            if (this.fitsCurrentTier(snapshot)) {
                this.currentDisplay = snapshot;
                this.selectedFileDisplayPins++;
            }
        }
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
            presentationGeneration: this.presentationGeneration,
            selectedFileDisplayAccesses: this.selectedFileDisplayAccesses,
            selectedFileDisplayHits: this.selectedFileDisplayHits,
            selectedFileDisplayMisses: this.selectedFileDisplayMisses,
            selectedFileDisplayBuilds: this.selectedFileDisplayBuilds,
            selectedFileDisplaySkips: this.selectedFileDisplaySkips,
            selectedFileDisplayPins: this.selectedFileDisplayPins,
            retainedSelectedFileRows: this.retainedDisplayRows,
            retainedSelectedFileWeightBytes: this.retainedDisplayWeightBytes,
            currentSelectedFileRows: this.currentDisplay?.rows.length ?? 0,
            currentSelectedFileWeightBytes: this.currentDisplay?.weightBytes ?? 0,
            richSelectedFileDisplayBuilds: this.richSelectedFileDisplayBuilds,
            plainSelectedFileDisplayBuilds: this.plainSelectedFileDisplayBuilds,
            syntaxHighlighterCalls: this.syntaxHighlighterCalls,
            themeInvalidations: this.themeInvalidations,
            treeBuilds: this.treeBuilds,
        };
    }
    isCurrent(snapshot, fileIndex) {
        return (snapshot?.documentVersion === this.documentVersion &&
            snapshot.presentationGeneration === this.presentationGeneration &&
            snapshot.fileIndex === fileIndex);
    }
    fitsNormalTier(snapshot) {
        return snapshot.rows.length <= MAX_RETAINED_DIFF_ROWS && snapshot.weightBytes <= MAX_RETAINED_DIFF_WEIGHT_BYTES;
    }
    fitsCurrentTier(snapshot) {
        return snapshot.rows.length <= MAX_CURRENT_DIFF_ROWS && snapshot.weightBytes <= MAX_CURRENT_DIFF_WEIGHT_BYTES;
    }
    clearPresentations() {
        this.selectedFileDisplaySnapshots.clear();
        this.retainedDisplayRows = 0;
        this.retainedDisplayWeightBytes = 0;
        this.currentDisplay = undefined;
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
        if (cached?.documentVersion === this.documentVersion)
            return cached;
        const rows = immutableRows(buildTreeRows([...this.files]));
        const fileOrder = [];
        const fileOrderIndex = new Map();
        const rowIndex = new Map();
        const fileIndexByPath = new Map();
        for (const [index, file] of this.files.entries()) {
            if (!fileIndexByPath.has(file.path))
                fileIndexByPath.set(file.path, index);
        }
        for (const [index, row] of rows.entries()) {
            if (row.fileIndex === undefined)
                continue;
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