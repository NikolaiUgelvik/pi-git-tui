export interface LiteralPathBudget {
    readonly argvChunkBytes: number;
    readonly argvChunkPaths: number;
}
export interface UntrackedDiffBudget extends LiteralPathBudget {
    readonly concurrency: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxPatchBytes: number;
    readonly maxPatchLines: number;
}
export interface TrackedDiffBudget extends LiteralPathBudget {
    readonly concurrency: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxPatchBytes: number;
    readonly maxPatchLines: number;
}
export interface CommitPromptBudget extends LiteralPathBudget {
    readonly concurrency: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxPatchChars: number;
    readonly maxPatchLines: number;
    readonly maxStatChars: number;
    readonly maxInputChars: number;
    readonly maxPromptChars: number;
}
export declare const DEFAULT_UNTRACKED_DIFF_BUDGET: Readonly<UntrackedDiffBudget>;
export declare const DEFAULT_TRACKED_DIFF_BUDGET: Readonly<TrackedDiffBudget>;
export declare const DEFAULT_COMMIT_PROMPT_BUDGET: Readonly<CommitPromptBudget>;
export declare const SUBMODULE_SOURCE_BYTES = 1024;
