import { type Focusable } from "@earendil-works/pi-tui";
import { type OverlayFrame } from "./overlay-frame.js";
import type { HelpContext } from "./types.js";
import { type HelpAction } from "./viewer-help.js";
import { DiffViewerWorktreePicker } from "./viewer-worktree-picker.js";
export declare class DiffViewer extends DiffViewerWorktreePicker implements Focusable {
    private activeFocusedField;
    private viewerFocused;
    get focused(): boolean;
    set focused(value: boolean);
    render(width: number): string[];
    private syncTextFieldFocus;
    protected renderOverlays(baseLines: string[], width: number): string[];
    protected renderActiveOverlay(baseLines: string[], width: number): string[];
    protected renderHelpOverlay(baseLines: string[], width: number): string[];
    protected helpOverlayLines(frame: OverlayFrame): string[];
    protected currentHelpContext(): HelpContext;
    protected helpTitle(context: HelpContext): string;
    protected helpActions(context: HelpContext): HelpAction[];
    protected renderHelpActionRows(action: HelpAction, width: number): string[];
    handleInput(data: string): void;
    invalidate(): void;
}
