import { type DiffDisplayRow } from "./diff-display.js";
import { type TreeRow } from "./tree.js";
import type { DiffFile } from "./types.js";
export interface SelectedFileDisplay {
    readonly rows: readonly DiffDisplayRow[];
    readonly gutterWidth: number;
}
export declare const MAX_RETAINED_DIFF_ROWS = 50000;
export declare const MAX_RETAINED_DIFF_WEIGHT_BYTES: number;
export interface ViewerRenderCacheStats {
    readonly documentVersion: number;
    readonly selectedFileDisplayAccesses: number;
    readonly selectedFileDisplayHits: number;
    readonly selectedFileDisplayMisses: number;
    readonly selectedFileDisplayBuilds: number;
    readonly selectedFileDisplaySkips: number;
    readonly retainedSelectedFileRows: number;
    readonly retainedSelectedFileWeightBytes: number;
    readonly treeBuilds: number;
}
export declare function diffDisplayGutterWidth(rows: readonly DiffDisplayRow[]): number;
/**
 * Holds one document generation of viewer derivations.
 *
 * Diff documents are treated as immutable between replaceDocument() calls.
 * Each replacement or explicit invalidation advances the version and drops the
 * row/byte-bounded selected-file LRU and tree snapshot, so historical documents
 * cannot accumulate in the cache.
 */
export declare class ViewerRenderCache {
    private files;
    private documentVersion;
    private selectedFileDisplayAccesses;
    private selectedFileDisplayHits;
    private selectedFileDisplayMisses;
    private selectedFileDisplayBuilds;
    private selectedFileDisplaySkips;
    private treeBuilds;
    private readonly selectedFileDisplaySnapshots;
    private retainedDisplayRows;
    private retainedDisplayWeightBytes;
    private treeSnapshotValue;
    constructor(files: readonly DiffFile[]);
    replaceDocument(files: readonly DiffFile[]): void;
    invalidate(): void;
    selectedFileDisplay(fileIndex: number): SelectedFileDisplay | undefined;
    treeRows(): readonly TreeRow[];
    treeFileOrder(): readonly number[];
    treeFileOrderIndex(fileIndex: number): number | undefined;
    treeRowIndex(fileIndex: number): number | undefined;
    fileIndexForPath(path: string): number | undefined;
    stats(): ViewerRenderCacheStats;
    private retainSelectedFileDisplay;
    private treeSnapshot;
}
