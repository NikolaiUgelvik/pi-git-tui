import { listStagedFiles, listUntrackedFiles } from "./git-file-list-service.js";
import { withLiteralPaths } from "./git-literal-path.js";
import { compactGitOutput, ensureGitRepository, GitExitError, probeGit, runGit, } from "./git-service.js";
import { loadWorkingTreeSnapshot } from "./git-status.js";
import { hasNestedSubmoduleChanges, isSubmoduleState, submoduleStateForPath } from "./git-submodule-state.js";
function throwFallbackFailure(attempts, defaultMessage) {
    const selected = attempts.find(({ result }) => compactGitOutput(result)) ?? attempts[0];
    if (!selected) {
        throw new Error(defaultMessage);
    }
    const message = compactGitOutput(selected.result) || defaultMessage;
    throw new GitExitError(selected.result, selected.args, message);
}
async function loadIndexActionState(pi, cwd, path, signal) {
    const result = await runGit(pi, cwd, withLiteralPaths(["ls-files", "--stage", "-z"], [path]), { signal });
    let submodule = false;
    let unmerged = false;
    for (const record of result.stdout.split("\0")) {
        if (!record)
            continue;
        const match = /^([0-7]{6}) [0-9a-f]+ ([0-3])\t/iu.exec(record);
        if (!match)
            throw new Error("Malformed git ls-files --stage output");
        submodule ||= match[1] === "160000";
        unmerged ||= match[2] !== "0";
    }
    return { submodule, unmerged };
}
async function assertSubmoduleActionIsSafe(pi, root, path, selection, indexState, signal) {
    const reported = typeof selection === "string" ? undefined : selection.submodule;
    if (hasNestedSubmoduleChanges(reported)) {
        throw new Error(`Cannot stage ${path}: manage nested changes inside the submodule`);
    }
    if (!indexState.submodule && !isSubmoduleState(reported))
        return;
    const snapshot = await loadWorkingTreeSnapshot(pi, root, signal);
    if (hasNestedSubmoduleChanges(submoduleStateForPath(snapshot, path))) {
        throw new Error(`Cannot stage ${path}: manage nested changes inside the submodule`);
    }
}
async function hasStagedChanges(pi, cwd, path, signal) {
    const result = await runGit(pi, cwd, withLiteralPaths(["diff", "--cached", "--quiet"], [path]), {
        signal,
        acceptedExitCodes: [0, 1],
    });
    return result.code === 1;
}
async function unstageFile(pi, cwd, path, signal) {
    const restoreArgs = withLiteralPaths(["restore", "--staged"], [path]);
    const restoreResult = await probeGit(pi, cwd, restoreArgs, { signal, timeoutClass: "mutation" });
    if (restoreResult.code === 0) {
        return;
    }
    await unstageFileWithoutHead(pi, cwd, path, signal, { result: restoreResult, args: restoreArgs });
}
async function unstageFileWithoutHead(pi, cwd, path, signal, restoreAttempt) {
    const resetArgs = withLiteralPaths(["reset"], [path]);
    const resetResult = await probeGit(pi, cwd, resetArgs, { signal, timeoutClass: "mutation" });
    if (resetResult.code === 0) {
        return;
    }
    const rmCachedArgs = withLiteralPaths(["rm", "--cached"], [path]);
    const rmCachedResult = await probeGit(pi, cwd, rmCachedArgs, { signal, timeoutClass: "mutation" });
    if (rmCachedResult.code === 0) {
        return;
    }
    throwFallbackFailure([{ result: rmCachedResult, args: rmCachedArgs }, { result: resetResult, args: resetArgs }, restoreAttempt], "Could not unstage file");
}
async function allChangesAreStaged(pi, root, signal) {
    const stagedFiles = await listStagedFiles(pi, root, signal);
    if (stagedFiles.size === 0) {
        return false;
    }
    const unstagedResult = await runGit(pi, root, ["diff", "--quiet", "--"], {
        signal,
        acceptedExitCodes: [0, 1],
    });
    const untrackedFiles = await listUntrackedFiles(pi, root, signal);
    return unstagedResult.code === 0 && untrackedFiles.length === 0;
}
async function unstageAllChanges(pi, root, signal) {
    const restoreArgs = ["restore", "--staged", "--", "."];
    const restoreResult = await probeGit(pi, root, restoreArgs, { signal, timeoutClass: "mutation" });
    if (restoreResult.code === 0) {
        return "Unstaged all changes";
    }
    const resetArgs = ["reset", "--", "."];
    const resetResult = await probeGit(pi, root, resetArgs, { signal, timeoutClass: "mutation" });
    if (resetResult.code === 0) {
        return "Unstaged all changes";
    }
    throwFallbackFailure([
        { result: resetResult, args: resetArgs },
        { result: restoreResult, args: restoreArgs },
    ], "Could not unstage changes");
}
export async function stageOrUnstageFile(pi, cwd, selection, signal) {
    const path = typeof selection === "string" ? selection : selection.path;
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        throw new Error("Not a git repository");
    }
    const indexState = await loadIndexActionState(pi, root, path, signal);
    await assertSubmoduleActionIsSafe(pi, root, path, selection, indexState, signal);
    const shouldUnstage = !indexState.unmerged &&
        (typeof selection === "string" ? await hasStagedChanges(pi, root, path, signal) : selection.staged);
    if (shouldUnstage) {
        await unstageFile(pi, root, path, signal);
        return `Unstaged ${path}`;
    }
    await runGit(pi, root, withLiteralPaths(["add"], [path]), { signal, timeoutClass: "mutation" });
    return `Staged ${path}`;
}
export async function toggleAllChangesStaged(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root) {
        throw new Error("Not a git repository");
    }
    if (await allChangesAreStaged(pi, root, signal)) {
        return unstageAllChanges(pi, root, signal);
    }
    await runGit(pi, root, ["add", "--all"], { signal, timeoutClass: "mutation" });
    return "Staged all changes";
}
export async function getStagedPaths(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    return root ? listStagedFiles(pi, root, signal) : new Set();
}
//# sourceMappingURL=git-index-service.js.map