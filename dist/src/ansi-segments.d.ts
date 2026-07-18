export interface SliceStyledColumnsOptions {
    pad?: boolean;
}
export declare function normalizeTabs(text: string): string;
export declare function sliceStyledColumns(line: string, startColumn: number, length: number, options?: SliceStyledColumnsOptions): string;
