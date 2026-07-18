import type { Theme } from "@earendil-works/pi-coding-agent";
import { type OverlayGeometry } from "./responsive-geometry.js";
export interface OverlayFrame {
    geometry: OverlayGeometry;
    innerWidth: number;
    bodyRows: number;
    maxItems: number;
    compact: boolean;
    row: (content: string) => string;
    border: (edge: "top" | "bottom") => string;
}
export declare function createOverlayFrame(baseLineCount: number, width: number, theme: Theme): OverlayFrame;
export declare function renderOverlayFrame(frame: OverlayFrame, title: string, hint: string, body: string[]): string[];
export declare function renderSearchOverlayFrame(frame: OverlayFrame, theme: Theme, title: string, hint: string, searchLine: string, bodyRows: string[]): string[];
