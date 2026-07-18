import { hasHeadCommit, requireGitRepository, runGit } from "./git-service.js";
export async function getBranches(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const format = "%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)";
    const result = await runGit(pi, root, ["branch", "--format", format], { signal });
    return result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
        const [name = "", head = "", upstream = "", track = ""] = line.split("\0");
        return { name, current: head.trim() === "*", upstream: upstream || undefined, track: track || undefined };
    });
}
export async function switchBranch(pi, cwd, branch, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    await runGit(pi, root, ["switch", branch], { signal, timeoutClass: "mutation" });
    return `Switched to ${branch}`;
}
export async function createAndSwitchBranch(pi, cwd, name, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    await runGit(pi, root, ["switch", "-c", name], { signal, timeoutClass: "mutation" });
    return `Created and switched to ${name}`;
}
export async function getBranchName(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const branchResult = await runGit(pi, root, ["branch", "--show-current"], { signal });
    if (branchResult.stdout.trim()) {
        return branchResult.stdout.trim();
    }
    if (!(await hasHeadCommit(pi, root, signal)))
        return;
    const headResult = await runGit(pi, root, ["rev-parse", "--short", "HEAD"], { signal });
    const head = headResult.stdout.trim();
    if (!head)
        throw new Error("Git returned an empty HEAD abbreviation");
    return `detached ${head}`;
}
//# sourceMappingURL=git-branch-service.js.map