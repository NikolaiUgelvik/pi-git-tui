import { type DiffFile, type FocusPanel } from "./types.js";
import { DiffViewerCore } from "./viewer-core.js";
import { type ViewerRenderCacheStats } from "./viewer-render-cache.js";
export declare class DiffViewerFrame extends DiffViewerCore {
    private diffMaximumColumn;
    private readonly renderCache;
    protected renderCacheStats(): ViewerRenderCacheStats;
    render(width: number): string[];
    private frameBorder;
    private renderMainPanel;
    private renderSummaryTitle;
    private renderTooSmallFrame;
    protected renderHeader(width: number): string;
    protected formatDiffStats(stats: {
        files: number;
        additions: number;
        deletions: number;
    }): string;
    protected formatCompactStats(stats: {
        files: number;
        additions: number;
        deletions: number;
    }): string;
    protected renderSubtitle(width: number): string;
    protected renderPanelTitle(panel: FocusPanel, width: number, single?: boolean): string;
    private diffColumnHint;
    protected renderFooter(width: number): string;
    private renderOperationFooter;
    private footerSummary;
    private renderRefreshFailureFooter;
    private renderOperationFailureFooter;
    private renderDocumentFooter;
    private renderNavigationFooter;
    private navigationTotals;
    protected renderTree(width: number, height: number): string[];
    protected colorTreeFile(line: string, file: DiffFile, selected: boolean): string;
    protected renderDiff(width: number, height: number): string[];
    protected renderFailurePanel(summary: string, details: string, width: number, height: number): string[];
    protected emptyDiffMessage(): string;
}
