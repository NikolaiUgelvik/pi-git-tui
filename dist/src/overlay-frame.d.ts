import type { Theme } from "@earendil-works/pi-coding-agent";
export interface OverlayFrame {
    maxItems: number;
    row: (content: string) => string;
    border: (edge: "top" | "bottom") => string;
}
export declare function createOverlayFrame(baseLineCount: number, width: number, theme: Theme): OverlayFrame;
export declare function renderSearchOverlayFrame(frame: OverlayFrame, theme: Theme, title: string, hint: string, searchLine: string, bodyRows: string[]): string[];
