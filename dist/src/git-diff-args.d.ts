export declare const CANONICAL_PATCH_OPTIONS: readonly ["--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--find-renames", "--find-copies", "--color=never"];
export declare function buildDiffArgs(input: {
    readonly command?: "diff" | "root-diff-tree";
    readonly options?: readonly string[];
    readonly revisions?: readonly string[];
    readonly paths?: readonly string[];
}): string[];
