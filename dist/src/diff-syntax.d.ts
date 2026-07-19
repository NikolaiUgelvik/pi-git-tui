import type { DiffDisplayRow } from "./diff-display.js";
import type { DiffFile } from "./types.js";
export interface SyntaxHighlighting {
    languageFromPath(path: string): string | undefined;
    highlight(code: string, language: string): readonly string[];
}
export declare const piSyntaxHighlighting: SyntaxHighlighting;
export interface DiffSyntaxPlan {
    /** Trusted generated ANSI, indexed like display rows. */
    readonly highlightedByRow: readonly (string | undefined)[];
    readonly supported: boolean;
    readonly fileLimitExceeded: boolean;
    readonly highlighterCalls: number;
}
export interface DiffSyntaxLimits {
    readonly richCodeRowsPerFile: number;
    readonly normalizedCodeBytesPerFile: number;
    readonly hunksPerFile: number;
    readonly linesPerSideSegment: number;
    readonly bytesPerSideSegment: number;
    readonly retainedGeneratedAnsiPerFile: number;
}
export declare const DIFF_SYNTAX_LIMITS: Readonly<DiffSyntaxLimits>;
export declare function planDiffSyntax(file: DiffFile, rows: readonly DiffDisplayRow[], normalizedTextByRow: readonly string[], syntax: SyntaxHighlighting): DiffSyntaxPlan;
