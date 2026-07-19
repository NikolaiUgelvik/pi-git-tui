export interface SgrState {
    bold: boolean;
    faint: boolean;
    italic: boolean;
    underline: boolean;
    inverse: boolean;
    strikethrough: boolean;
    foreground?: string;
    background?: string;
}
export interface ParsedTrustedText {
    readonly plainText: string;
    readonly runs: {
        readonly start: number;
        readonly end: number;
        readonly state: SgrState;
    }[];
}
export declare function emptySgrState(): SgrState;
export declare function canonicalSgrPrefix(state: SgrState): string;
export declare function sgrStateFromAnsi(ansi: string | undefined): SgrState | undefined;
export declare function blendedBackgroundAnsi(baseAnsi: string, accentAnsi: string, accentWeight?: number): string;
export declare function parseTrustedSgrText(text: string): ParsedTrustedText | undefined;
