export interface GitPatchParts {
    readonly preamble: string;
    readonly chunks: readonly string[];
}
export declare function utf8Bytes(value: string): number;
export declare function textLineCount(value: string): number;
export declare function splitGitPatch(raw: string): GitPatchParts;
