import type { StyledColumns } from "./ansi-segments.js";
export interface StyledColumnSlice {
    readonly start: number;
    readonly length: number;
}
export interface PreparedColumnWrap {
    readonly segmentCount: number;
    segments(startSegment: number, count: number): readonly StyledColumnSlice[];
}
export interface WrappedColumnMeasure {
    readonly segmentCount: number;
    readonly truncated: boolean;
}
export declare function measureWrappedColumns(line: StyledColumns, maxWidth: number, maximumSegments: number): WrappedColumnMeasure;
export declare function prepareColumnWrap(line: StyledColumns, maxWidth: number): PreparedColumnWrap;
