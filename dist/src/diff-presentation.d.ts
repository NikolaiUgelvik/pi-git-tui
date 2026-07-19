import type { Theme } from "@earendil-works/pi-coding-agent";
import { type StyledColumns } from "./ansi-segments.js";
import { type DiffDisplayRow } from "./diff-display.js";
import { type SyntaxHighlighting } from "./diff-syntax.js";
import type { DiffFile } from "./types.js";
export interface PreparedDiffRow {
    readonly semantic: DiffDisplayRow;
    readonly gutter: StyledColumns;
    readonly content: StyledColumns;
}
export interface PreparedDiffDisplay {
    readonly rows: readonly PreparedDiffRow[];
    /** Total terminal cells, including marker, digits, separator, and spaces. */
    readonly gutterWidth: number;
    readonly maxContentWidth: number;
    readonly weightBytes: number;
    readonly mode: "rich" | "plain";
    readonly highlighterCalls: number;
}
export declare function prepareDiffPresentation(file: DiffFile, theme: Theme, syntax?: SyntaxHighlighting): PreparedDiffDisplay;
