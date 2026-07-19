export interface IntralineToken {
    readonly text: string;
    readonly start: number;
    readonly end: number;
    readonly whitespace: boolean;
}
export interface TokenizedIntralineLine {
    readonly text: string;
    readonly tokens: readonly IntralineToken[];
    readonly graphemeCount: number;
}
export interface LineAlignmentEntry {
    readonly oldIndex?: number;
    readonly newIndex?: number;
}
export declare function tokenizeIntralineLine(text: string, maximumGraphemes: number, maximumTokens: number): TokenizedIntralineLine | undefined;
export declare function alignIntralineLines(oldLines: readonly TokenizedIntralineLine[], newLines: readonly TokenizedIntralineLine[]): readonly LineAlignmentEntry[];
export interface TokenChanges {
    readonly oldChanged: readonly number[];
    readonly newChanged: readonly number[];
}
export declare function changedTokenIndices(oldTokens: readonly IntralineToken[], newTokens: readonly IntralineToken[]): TokenChanges;
