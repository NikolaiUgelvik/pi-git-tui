import type { Theme } from "@earendil-works/pi-coding-agent";
import { type DiffDisplayRow } from "./diff-display.js";
import type { DiffFile } from "./types.js";
export interface DiffViewportInput {
    file: DiffFile;
    width: number;
    height: number;
    verticalOffset: number;
    horizontalOffset: number;
    theme: Theme;
    displayRows?: readonly DiffDisplayRow[];
}
export interface DiffViewportResult {
    lines: string[];
    verticalOffset: number;
    horizontalOffset: number;
    maxVerticalOffset: number;
    maxHorizontalOffset: number;
    horizontallyScrollable: boolean;
    gutterWidth: number;
    contentWidth: number;
}
export declare function renderDiffViewport(input: DiffViewportInput): DiffViewportResult;
