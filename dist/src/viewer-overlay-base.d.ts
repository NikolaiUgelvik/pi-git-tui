import { type OverlayDensity } from "./responsive-geometry.js";
import { DiffViewerFrame } from "./viewer-frame.js";
export interface ViewerOverlayLayout {
    overlayWidth: number;
    leftPad: number;
    startLine: number;
    height: number;
    maxItems: number;
    density: OverlayDensity;
}
export declare class DiffViewerOverlayBase extends DiffViewerFrame {
    protected commitPickerOverlayLayout(baseLineCount: number, width: number): ViewerOverlayLayout;
    protected commitPickerOverlayRow(content: string, overlayWidth: number): string;
    protected commitPickerBorder(edge: "top" | "bottom", overlayWidth: number): string;
    protected applyCommitPickerOverlay(baseLines: string[], overlay: string[], layout: ViewerOverlayLayout, width: number): string[];
    protected mergeOverlayLine(baseLine: string | undefined, overlayLine: string, layout: {
        overlayWidth: number;
        leftPad: number;
    }, width: number): string;
    private closeAnsiSegment;
}
