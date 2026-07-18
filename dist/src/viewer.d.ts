import type { HelpContext } from "./types.js";
import { type HelpAction } from "./viewer-help.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export declare class DiffViewer extends DiffViewerWorktreePicker {
    protected renderOverlays(baseLines: string[], width: number): string[];
    protected renderActiveOverlay(baseLines: string[], width: number): string[];
    protected renderHelpOverlay(baseLines: string[], width: number): string[];
    protected helpOverlayLines(overlayWidth: number): string[];
    protected currentHelpContext(): HelpContext;
    protected helpTitle(context: HelpContext): string;
    protected helpActions(context: HelpContext): HelpAction[];
    protected renderHelpAction(action: HelpAction): string;
    handleInput(data: string): void;
    invalidate(): void;
}
