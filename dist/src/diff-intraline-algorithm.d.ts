export interface IntralineRange {
    readonly start: number;
    readonly end: number;
}
export interface RelativeIntralineChanges {
    readonly oldRange?: IntralineRange;
    readonly newRange?: IntralineRange;
    readonly graphemeCount: number;
}
export declare function relativeIntralineChanges(oldText: string, newText: string, maximumGraphemes: number): RelativeIntralineChanges | undefined;
