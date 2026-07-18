import { requireGitRepository, runGit } from "./git-service.js";
function worktreeBranchName(ref) {
    return ref.replace(/^refs\/heads\//u, "");
}
function parseWorktreeRecord(fields) {
    const worktree = { path: "" };
    for (const field of fields) {
        const separator = field.indexOf(" ");
        const key = separator < 0 ? field : field.slice(0, separator);
        const value = separator < 0 ? "" : field.slice(separator + 1);
        if (key === "worktree")
            worktree.path = value;
        else if (key === "HEAD")
            worktree.head = value;
        else if (key === "branch")
            worktree.branch = worktreeBranchName(value);
        else if (key === "detached")
            worktree.detached = true;
        else if (key === "bare")
            worktree.bare = true;
    }
    return worktree.path ? worktree : undefined;
}
export function parseWorktreeList(output) {
    const records = output.includes("\0")
        ? output.split("\0\0").map((record) => record.split("\0").filter(Boolean))
        : output.split(/\n\s*\n/u).map((record) => record.trim().split("\n").filter(Boolean));
    return records.flatMap((fields) => {
        const worktree = parseWorktreeRecord(fields);
        return worktree ? [worktree] : [];
    });
}
export async function getWorktrees(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const args = ["worktree", "list", "--porcelain", "-z"];
    const result = await runGit(pi, root, args, { signal });
    return parseWorktreeList(result.stdout);
}
export async function listWorktrees(pi, cwd, signal) {
    return getWorktrees(pi, cwd, signal);
}
export async function switchWorktree(pi, cwd, path, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const args = ["worktree", "add", "-f", path, "--detach"];
    await runGit(pi, root, args, { signal, timeoutClass: "mutation" });
    return `Created worktree at ${path}`;
}
//# sourceMappingURL=git-worktree-service.js.map