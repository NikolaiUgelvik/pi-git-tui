import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable } from "@earendil-works/pi-tui";
import { type OverlayFrame } from "./overlay-frame.js";
import type { DiffDocument, HelpContext } from "./types.js";
import type { ViewerInitialDocument } from "./viewer-document-state.js";
import { type HelpAction } from "./viewer-help.js";
import type { DiffViewerOptions } from "./viewer-operation-base.js";
import { DiffViewerTagPicker } from "./viewer-tag-picker.js";
export declare class DiffViewer extends DiffViewerTagPicker implements Focusable {
    private activeFocusedField;
    private readonly settingsFeature;
    private viewerFocused;
    constructor(pi: ExtensionAPI, ctx: ExtensionContext, theme: Theme, initialDocument: DiffDocument | ViewerInitialDocument, done: () => void, requestRender: () => void, getTerminalRows: () => number, viewerOptions: DiffViewerOptions);
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
    protected invalidateDiffPresentation(): void;
    invalidate(): void;
}
