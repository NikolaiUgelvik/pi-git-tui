import { probeGit, requireGitRepository, runGit } from "./git-service.js";
function worktreeBranchName(ref) {
    return ref.replace(/^refs\/heads\//u, "");
}
export function parseWorktreeList(output) {
    return output
        .split(/\n\s*\n/u)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
        const worktree = { path: "" };
        for (const line of record.split("\n")) {
            const [key = "", ...valueParts] = line.split(" ");
            const value = valueParts.join(" ");
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
        return worktree;
    })
        .filter((worktree) => worktree.path.length > 0);
}
export async function getWorktrees(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const result = await runGit(pi, root, ["worktree", "list", "--porcelain"], { signal });
    return parseWorktreeList(result.stdout);
}
export async function listWorktrees(pi, cwd, signal) {
    return getWorktrees(pi, cwd, signal);
}
export async function switchWorktree(pi, cwd, path, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const result = await probeGit(pi, root, ["worktree", "add", "-f", path, "--detach"], {
        signal,
        timeoutClass: "mutation",
    });
    return result.code === 0 ? `Created worktree at ${path}` : `Switched to worktree at ${path}`;
}
//# sourceMappingURL=git-worktree-service.js.map