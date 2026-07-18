import type { DiffFile } from "./types.js";
export interface TreeRow {
    label: string;
    fileIndex?: number;
    depth: number;
    isLast: boolean;
}
export declare function buildTreeRows(files: readonly DiffFile[]): TreeRow[];
