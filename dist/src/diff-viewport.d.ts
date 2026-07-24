import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PreparedDiffDisplay } from "./diff-presentation.js";
export interface DiffViewportInput {
    readonly display: PreparedDiffDisplay;
    readonly width: number;
    readonly height: number;
    readonly verticalOffset: number;
    readonly horizontalOffset: number;
    readonly wrap?: boolean;
    readonly theme: Theme;
}
export interface DiffViewportResult {
    readonly lines: string[];
    readonly verticalOffset: number;
    readonly horizontalOffset: number;
    readonly maxVerticalOffset: number;
    readonly maxHorizontalOffset: number;
    readonly verticallyScrollable: boolean;
    readonly horizontallyScrollable: boolean;
    readonly contentHeight: number;
    readonly gutterWidth: number;
    readonly contentWidth: number;
}
export declare function renderDiffViewport(input: DiffViewportInput): DiffViewportResult;
