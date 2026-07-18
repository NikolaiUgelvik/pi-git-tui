import type { FocusPanel } from "./types.js";
export declare const SPLIT_LAYOUT_MIN_WIDTH = 72;
export type ViewerDensity = "normal" | "compact" | "too-small";
export type MainLayout = "split" | "single" | "empty" | "too-small";
export type OverlayDensity = "normal" | "compact";
export interface ViewerGeometry {
    width: number;
    height: number;
    innerWidth: number;
    density: ViewerDensity;
    layout: MainLayout;
    panelRows: number;
    bodyRows: number;
    separatorWidth: number;
    treeWidth: number;
    diffWidth: number;
    mainWidth: number;
}
export interface ViewerGeometryInput {
    width: number;
    terminalRows: number;
    focusedPanel: FocusPanel;
    empty: boolean;
}
export interface OverlayGeometry {
    left: number;
    top: number;
    width: number;
    height: number;
    innerWidth: number;
    bodyRows: number;
    density: OverlayDensity;
}
export interface OverlayGeometryInput {
    width: number;
    height: number;
}
export interface OverlayGeometryOptions {
    preferredBodyRows?: number;
    preferredWidth?: number;
}
export declare function measureViewerGeometry(input: ViewerGeometryInput): ViewerGeometry;
export declare function measureOverlayGeometry(input: OverlayGeometryInput, options?: OverlayGeometryOptions): OverlayGeometry;
