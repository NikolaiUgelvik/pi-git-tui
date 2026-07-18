import { withLiteralPaths } from "./git-literal-path.js";
import { compactGitOutput, ensureGitRepository, GitExitError, probeGit, requireGitRepository, runGit, } from "./git-service.js";
import { loadWorkingTreeSnapshot } from "./git-status.js";
import { hasNestedSubmoduleChanges, isSubmoduleState } from "./git-submodule-state.js";
// Re-export from focused service modules
export { createAndSwitchBranch, getBranches as listBranches, switchBranch } from "./git-branch-service.js";
export { applyStash, dropStash, getStashes as listStashes, popStash, stashCurrentChanges, } from "./git-stash-service.js";
export { listWorktrees, parseWorktreeList } from "./git-worktree-service.js";
function throwDiscardFailure(attempts) {
    const selected = attempts.find(({ result }) => compactGitOutput(result)) ?? attempts[0];
    if (!selected) {
        throw new Error("Could not discard changes");
    }
    throw new GitExitError(selected.result, selected.args, compactGitOutput(selected.result) || "Could not discard changes");
}
export async function initializeGitRepository(pi, cwd, signal) {
    const existing = await ensureGitRepository(pi, cwd, signal);
    if (existing) {
        return `Already a git repository: ${existing}`;
    }
    await runGit(pi, cwd, ["init"], { signal, timeoutClass: "mutation" });
    const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd;
    return `Initialized git repository in ${root}`;
}
async function hasHead(pi, cwd, signal) {
    return (await loadWorkingTreeSnapshot(pi, cwd, signal)).head.kind !== "initial";
}
function assertSubmoduleDiscardIsSafe(file) {
    if (!isSubmoduleState(file.submodule))
        return;
    const detail = hasNestedSubmoduleChanges(file.submodule)
        ? "manage nested changes inside the submodule"
        : "update the submodule checkout explicitly";
    throw new Error(`Cannot discard ${file.path}: ${detail}`);
}
async function selectedFileIsUntracked(pi, root, path, signal) {
    const result = await runGit(pi, root, withLiteralPaths(["ls-files", "--others", "--exclude-standard", "-z"], [path]), {
        signal,
    });
    return result.stdout.split("\0").filter(Boolean).includes(path);
}
function discardPaths(file) {
    const paths = file.status === "renamed" ? [file.oldPath, file.newPath, file.path] : [file.path];
    return [...new Set(paths.filter((path) => path !== undefined && path !== "/dev/null"))];
}
async function cleanUntrackedPath(pi, root, path, signal) {
    await runGit(pi, root, withLiteralPaths(["clean", "-f"], [path]), { signal, timeoutClass: "mutation" });
    return `Removed untracked ${path}`;
}
async function removeNoHeadPaths(pi, root, paths, signal, restoreAttempt) {
    const rmArgs = withLiteralPaths(["rm", "-f"], paths);
    const rmResult = await probeGit(pi, root, rmArgs, { signal, timeoutClass: "mutation" });
    if (rmResult.code !== 0) {
        throwDiscardFailure([{ result: rmResult, args: rmArgs }, restoreAttempt]);
    }
}
async function discardWithHeadFallback(pi, root, paths, signal, restoreAttempt) {
    const resetArgs = withLiteralPaths(["reset"], paths);
    const resetResult = await probeGit(pi, root, resetArgs, { signal, timeoutClass: "mutation" });
    if (resetResult.code !== 0) {
        throwDiscardFailure([{ result: resetResult, args: resetArgs }, restoreAttempt]);
    }
    const worktreeArgs = withLiteralPaths(["restore", "--worktree"], paths);
    const worktreeResult = await probeGit(pi, root, worktreeArgs, { signal, timeoutClass: "mutation" });
    if (worktreeResult.code === 0) {
        return;
    }
    const cleanArgs = withLiteralPaths(["clean", "-f"], paths);
    const cleanResult = await probeGit(pi, root, cleanArgs, { signal, timeoutClass: "mutation" });
    if (cleanResult.code === 0) {
        return;
    }
    throwDiscardFailure([
        { result: cleanResult, args: cleanArgs },
        { result: worktreeResult, args: worktreeArgs },
    ]);
}
export async function discardFileChanges(pi, cwd, file, signal) {
    if (file.omission) {
        throw new Error(`Cannot discard ${file.path} because its diff was omitted`);
    }
    assertSubmoduleDiscardIsSafe(file);
    const root = await requireGitRepository(pi, cwd, signal);
    const currentlyUntracked = file.untracked || (await selectedFileIsUntracked(pi, root, file.path, signal));
    if (currentlyUntracked && file.untrackedRole !== "replacement" && !file.staged) {
        return cleanUntrackedPath(pi, root, file.path, signal);
    }
    const paths = discardPaths(file);
    if (paths.length === 0) {
        throw new Error("No selected file path to discard");
    }
    const restoreArgs = withLiteralPaths(["restore", "--staged", "--worktree"], paths);
    const restoreResult = await probeGit(pi, root, restoreArgs, { signal, timeoutClass: "mutation" });
    if (restoreResult.code !== 0) {
        const restoreAttempt = { result: restoreResult, args: restoreArgs };
        if (await hasHead(pi, root, signal)) {
            await discardWithHeadFallback(pi, root, paths, signal, restoreAttempt);
        }
        else {
            await removeNoHeadPaths(pi, root, paths, signal, restoreAttempt);
        }
    }
    return `Discarded changes in ${file.path}`;
}
//# sourceMappingURL=git-extras.js.map