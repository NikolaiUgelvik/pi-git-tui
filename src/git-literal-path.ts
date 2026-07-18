/** Build a Git command whose final path arguments cannot activate pathspec magic. */
export function withLiteralPaths(args: readonly string[], paths: readonly string[]): string[] {
  return ["--literal-pathspecs", ...args, "--", ...paths]
}
