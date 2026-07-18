import type { LiteralPathBudget } from "./diff-budgets.js";
export declare function literalPathsFit(paths: readonly string[], budget: LiteralPathBudget, fixedArgs?: readonly string[]): boolean;
export declare function chunkLiteralPaths(paths: readonly string[], budget: LiteralPathBudget, fixedArgs?: readonly string[]): string[][];
export interface LiteralPathGroup<T> {
    readonly value: T;
    readonly paths: readonly string[];
}
export interface LiteralPathGroupChunks<T> {
    readonly batches: readonly (readonly T[])[];
    readonly oversized: readonly T[];
}
export declare function chunkLiteralPathGroups<T>(groups: readonly LiteralPathGroup<T>[], budget: LiteralPathBudget, fixedArgs?: readonly string[]): LiteralPathGroupChunks<T>;
export declare function nulRecords(raw: string): string[];
export declare function pathAfterTab(record: string): string | undefined;
