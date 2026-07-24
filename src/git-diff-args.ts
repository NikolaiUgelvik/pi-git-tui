export const CANONICAL_PATCH_OPTIONS = [
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules=none",
  "--find-renames",
  "--find-copies",
  "--color=never",
] as const

export function buildDiffArgs(input: {
  readonly command?: "diff" | "root-diff-tree"
  readonly options?: readonly string[]
  readonly revisions?: readonly string[]
  readonly paths?: readonly string[]
}): string[] {
  const root = input.command === "root-diff-tree"
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
  ]
}
