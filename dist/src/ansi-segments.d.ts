export interface StyledColumns {
    readonly plainText: string;
    readonly width: number;
    readonly weightBytes: number;
}
export interface StyledSpanDecoration {
    readonly start: number;
    readonly end: number;
    readonly foregroundAnsi?: string;
    readonly backgroundAnsi?: string;
    readonly bold?: boolean;
}
export interface PrepareStyledColumnsOptions {
    readonly expectedPlainText?: string;
    readonly baseForegroundAnsi?: string;
    readonly backgroundAnsi?: string;
    readonly decorations?: readonly StyledSpanDecoration[];
    readonly paddingForegroundAnsi?: string;
    readonly paddingBackgroundAnsi?: string;
}
export interface SliceStyledColumnsOptions {
    readonly pad?: boolean;
    readonly padTo?: number;
}
export declare function normalizeDiffText(text: string): string;
export declare function normalizeTabs(text: string): string;
export declare function stripTrustedSgr(text: string): string | undefined;
export declare function prepareStyledColumns(trustedStyledText: string, options?: PrepareStyledColumnsOptions): StyledColumns | undefined;
export declare function slicePreparedColumns(line: StyledColumns, startColumn: number, length: number, options?: SliceStyledColumnsOptions): string;
export declare function sliceStyledColumns(line: string, startColumn: number, length: number, options?: SliceStyledColumnsOptions): string;
