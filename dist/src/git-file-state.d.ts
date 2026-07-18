export type GitFileState = {
    readonly kind: "file";
    readonly bytes: number;
    readonly signature: string;
    readonly symlink: boolean;
} | {
    readonly kind: "missing";
} | {
    readonly kind: "unsupported";
    readonly description: string;
};
export declare function loadGitFileState(root: string, path: string): Promise<GitFileState>;
export declare function sameGitFileState(before: GitFileState, after: GitFileState): boolean;
