export const CANONICAL_PATCH_OPTIONS = [
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "--find-renames",
    "--find-copies",
    "--color=never",
];
export function buildDiffArgs(input) {
    const root = input.command === "root-diff-tree";
    return [
        "-c",
        "core.quotepath=false",
        ...(input.paths === undefined ? [] : ["--literal-pathspecs"]),
        root ? "diff-tree" : "diff",
        ...(root ? ["--root", "--no-commit-id", "-r"] : []),
        ...(input.options ?? []),
        ...(input.revisions ?? []),
        "--",
        ...(input.paths ?? []),
    ];
}
//# sourceMappingURL=git-diff-args.js.map