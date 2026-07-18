/** Build a Git command whose final path arguments cannot activate pathspec magic. */
export function withLiteralPaths(args, paths) {
    return ["--literal-pathspecs", ...args, "--", ...paths];
}
//# sourceMappingURL=git-literal-path.js.map