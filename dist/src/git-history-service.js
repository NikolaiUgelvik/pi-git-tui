import { assertGitSuccess, isUnbornHeadResult, probeGit, requireGitRepository, runGit } from "./git-service.js";
import { COMMIT_LIMIT } from "./types.js";
export async function getCommits(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const args = ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"];
    const result = await probeGit(pi, root, args, { signal });
    if (isUnbornHeadResult(result))
        return [];
    assertGitSuccess(result, args, root);
    if (!result.stdout.trim())
        return [];
    return result.stdout.split("\n").map((line) => {
        const [hash = "", ...messageParts] = line.split("\t");
        return { hash, message: messageParts.join("\t") };
    });
}
export { getCommits as loadCommits };
export async function getCommitMessage(pi, cwd, hash, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    return (await runGit(pi, root, ["log", "-1", "--format=%s", hash], { signal })).stdout.trim();
}
export async function getCommitCount(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const args = ["rev-list", "--count", "HEAD"];
    const result = await probeGit(pi, root, args, { signal });
    if (isUnbornHeadResult(result))
        return 0;
    assertGitSuccess(result, args, root);
    const count = Number.parseInt(result.stdout.trim(), 10);
    if (!Number.isFinite(count)) {
        throw new Error(`git rev-list returned an invalid commit count: ${result.stdout.trim() || "(empty)"}`);
    }
    return count;
}
//# sourceMappingURL=git-history-service.js.map