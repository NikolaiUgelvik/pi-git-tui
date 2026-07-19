import type { DiffDisplayRow } from "./diff-display.js";
export interface ChangedSpan {
    /** UTF-16 offsets in normalized plain text. */
    readonly start: number;
    readonly end: number;
}
export interface IntralinePlan {
    /** Indexed exactly like the input display rows. */
    readonly spansByRow: readonly (readonly ChangedSpan[] | undefined)[];
}
export interface IntralineLimits {
    readonly lineUtf16Units: number;
    readonly graphemesPerLine: number;
    readonly rowsPerRun: number;
    readonly linesPerSide: number;
    readonly changeRowsPerFile: number;
    readonly changeRunsPerFile: number;
    readonly graphemesPerFile: number;
}
export declare const INTRALINE_LIMITS: Readonly<IntralineLimits>;
export declare function planIntralineChanges(rows: readonly DiffDisplayRow[], normalizedTextByRow: readonly string[]): IntralinePlan;
