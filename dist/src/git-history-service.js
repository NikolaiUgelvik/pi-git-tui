import { ensureGitRepository, hasHeadCommit, runGit } from "./git-service.js";
import { COMMIT_LIMIT } from "./types.js";
export async function getCommits(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        return [];
    }
    if (!(await hasHeadCommit(pi, root, signal)))
        return [];
    const result = await runGit(pi, root, ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"], {
        signal,
    });
    if (!result.stdout.trim()) {
        return [];
    }
    return result.stdout.split("\n").map((line) => {
        const [hash = "", ...messageParts] = line.split("\t");
        return { hash, message: messageParts.join("\t") };
    });
}
// Alias for loadCommits (public API name used by viewer-commit-picker.ts)
export { getCommits as loadCommits };
export async function getCommitMessage(pi, cwd, hash, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        return "";
    }
    if (!(await hasHeadCommit(pi, root, signal)))
        return "";
    const result = await runGit(pi, root, ["log", "-1", "--format=%s", hash], { signal });
    return result.stdout.trim();
}
export async function getCommitCount(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        return 0;
    }
    if (!(await hasHeadCommit(pi, root, signal)))
        return 0;
    const result = await runGit(pi, root, ["rev-list", "--count", "HEAD"], { signal });
    const count = Number(result.stdout.trim());
    if (!Number.isSafeInteger(count) || count < 0)
        throw new Error("Git returned an invalid commit count");
    return count;
}
//# sourceMappingURL=git-history-service.js.map