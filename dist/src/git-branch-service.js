import { assertGitSuccess, isUnbornHeadResult, probeGit, requireGitRepository, runGit } from "./git-service.js";
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
    const branch = (await runGit(pi, root, ["branch", "--show-current"], { signal })).stdout.trim();
    if (branch)
        return branch;
    const headArgs = ["rev-parse", "--short", "HEAD"];
    const headResult = await probeGit(pi, root, headArgs, { signal });
    if (isUnbornHeadResult(headResult))
        return;
    assertGitSuccess(headResult, headArgs, root);
    const head = headResult.stdout.trim();
    if (!head)
        throw new Error("git rev-parse returned an empty detached HEAD");
    return `detached ${head}`;
}
//# sourceMappingURL=git-branch-service.js.map