import type { DiffDisplayRow } from "./diff-display.js";
import { type DiffFile, type FocusPanel } from "./types.js";
import { DiffViewerNavigation } from "./viewer-navigation.js";
export declare class DiffViewerFrame extends DiffViewerNavigation {
    render(width: number): string[];
    protected renderHeader(width: number): string;
    protected renderSubtitle(width: number): string;
    protected renderPanelTitle(panel: FocusPanel, width: number): string;
    protected renderFooter(width: number): string;
    protected renderTree(width: number, height: number): string[];
    protected colorTreeFile(line: string, file: DiffFile, selected: boolean): string;
    /**
     * Clamp diffScroll to valid range. Call this before renderDiff() to ensure
     * the scroll position is valid for the current document state.
     */
    protected clampDiffScroll(): void;
    protected renderDiff(width: number, height: number): string[];
    protected renderDiffDisplayRow(row: DiffDisplayRow, file: DiffFile, gutterWidth: number): string;
    protected diffDisplayRowText(row: DiffDisplayRow, file: DiffFile, gutterWidth: number): string;
    protected hunkRange(row: Extract<DiffDisplayRow, {
        type: "hunk";
    }>): string;
    protected lineRange(start: number, count: number): string;
    protected isNumberedDiffRow(row: DiffDisplayRow): row is Extract<DiffDisplayRow, {
        type: "context" | "addition" | "deletion";
    }>;
    protected colorDiffDisplayRow(row: DiffDisplayRow, line: string): string;
    protected emptyDiffMessage(): string;
    protected colorDiffLine(line: string): string;
}
