import { DiffViewerFrame } from "./viewer-frame.js";
export declare class DiffViewerOverlayBase extends DiffViewerFrame {
    protected commitPickerOverlayLayout(baseLineCount: number, width: number): {
        overlayWidth: number;
        leftPad: number;
        startLine: number;
        maxItems: number;
    };
    protected commitPickerOverlayRow(content: string, overlayWidth: number): string;
    protected commitPickerBorder(edge: "top" | "bottom", overlayWidth: number): string;
    protected applyCommitPickerOverlay(baseLines: string[], overlay: string[], layout: {
        overlayWidth: number;
        leftPad: number;
        startLine: number;
    }, width: number): string[];
    protected mergeOverlayLine(baseLine: string | undefined, overlayLine: string, layout: {
        overlayWidth: number;
        leftPad: number;
    }, width: number): string;
    private closeAnsiSegment;
}
