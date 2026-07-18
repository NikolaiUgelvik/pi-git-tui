import { collectCommitDiffInput } from "./commit-diff-input.js";
import { diffFileOperationPaths } from "./diff-document.js";
import { listStagedFiles } from "./git-file-list-service.js";
import { withLiteralPaths } from "./git-literal-path.js";
import { compactGitOutput, ensureGitRepository, GitExitError, probeGit, runGit, } from "./git-service.js";
import { loadWorkingTreeSnapshot } from "./git-status.js";
import { hasNestedSubmoduleChanges, isSubmoduleState, submoduleStateForPath } from "./git-submodule-state.js";
function isDiffFile(pathspec) {
    return typeof pathspec === "object" && !Array.isArray(pathspec);
}
function indexSelection(pathspec) {
    let file;
    let values;
    if (isDiffFile(pathspec)) {
        file = pathspec;
        values = diffFileOperationPaths(pathspec);
    }
    else {
        values = typeof pathspec === "string" ? [pathspec] : pathspec;
    }
    const paths = [...new Set(values)].filter(Boolean);
    if (paths.length === 0)
        throw new Error("No file path was selected");
    return { paths, ...(file ? { file } : {}) };
}
function displayPath(paths) {
    return paths[0] ?? "selected file";
}
function throwFallbackFailure(attempts, defaultMessage, root) {
    const selected = attempts.find(({ result }) => compactGitOutput(result)) ?? attempts[0];
    if (!selected)
        throw new Error(defaultMessage);
    throw new GitExitError(selected.result, selected.args, compactGitOutput(selected.result) || defaultMessage, root);
}
async function runFirstSuccessfulIndexCommand(pi, root, commands, signal) {
    const failures = [];
    for (const args of commands) {
        const result = await probeGit(pi, root, args, { signal, timeoutClass: "mutation" });
        if (result.code === 0)
            return;
        failures.push({ args, result });
    }
    throwFallbackFailure(failures, "Could not update the index", root);
}
async function indexSubmodulePaths(pi, root, paths, signal) {
    const result = await runGit(pi, root, withLiteralPaths(["ls-files", "--stage", "-z"], paths), { signal });
    const submodules = new Set();
    for (const record of result.stdout.split("\0")) {
        if (!record)
            continue;
        const match = /^([0-7]{6}) [0-9a-f]+ [0-3]\t(.*)$/su.exec(record);
        if (!match)
            throw new Error("Malformed git ls-files --stage output");
        if (match[1] === "160000" && match[2])
            submodules.add(match[2]);
    }
    return submodules;
}
async function assertSubmoduleActionIsSafe(pi, root, selection, signal) {
    if (hasNestedSubmoduleChanges(selection.file?.submodule)) {
        throw new Error(`Cannot stage ${displayPath(selection.paths)}: manage nested changes inside the submodule`);
    }
    const indexSubmodules = await indexSubmodulePaths(pi, root, selection.paths, signal);
    if (indexSubmodules.size === 0 && !isSubmoduleState(selection.file?.submodule))
        return;
    const snapshot = await loadWorkingTreeSnapshot(pi, root, signal);
    const unsafe = selection.paths.find((path) => hasNestedSubmoduleChanges(submoduleStateForPath(snapshot, path)));
    if (unsafe)
        throw new Error(`Cannot stage ${unsafe}: manage nested changes inside the submodule`);
}
function unstageCommands(paths) {
    return [
        withLiteralPaths(["restore", "--staged"], paths),
        withLiteralPaths(["reset"], paths),
        withLiteralPaths(["rm", "--cached", "-r", "-f"], paths),
    ];
}
async function stagePaths(pi, root, paths, signal) {
    await runFirstSuccessfulIndexCommand(pi, root, [withLiteralPaths(["add", "--all"], paths), withLiteralPaths(["add", "--update"], paths)], signal);
}
export async function stageRemainingFile(pi, cwd, pathspec, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    const selection = indexSelection(pathspec);
    await assertSubmoduleActionIsSafe(pi, root, selection, signal);
    await stagePaths(pi, root, selection.paths, signal);
    return `Staged remaining changes in ${displayPath(selection.paths)}`;
}
export async function unstageFile(pi, cwd, pathspec, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    const selection = indexSelection(pathspec);
    await assertSubmoduleActionIsSafe(pi, root, selection, signal);
    await runFirstSuccessfulIndexCommand(pi, root, unstageCommands(selection.paths), signal);
    return `Unstaged ${displayPath(selection.paths)}`;
}
export async function stageAllRemaining(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    const snapshot = await loadWorkingTreeSnapshot(pi, root, signal);
    if (snapshot.entries.some((entry) => hasNestedSubmoduleChanges(entry.submodule))) {
        throw new Error("Cannot stage all while nested submodule changes are present");
    }
    await runGit(pi, root, ["add", "--all"], { signal, timeoutClass: "mutation" });
    return "Staged all remaining changes";
}
export async function unstageAll(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    await runFirstSuccessfulIndexCommand(pi, root, [
        ["restore", "--staged", "--", "."],
        ["reset", "--", "."],
        ["rm", "--cached", "-r", "-f", "--", "."],
    ], signal);
    return "Unstaged all changes";
}
export async function getStagedPaths(pi, cwd, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    return root ? listStagedFiles(pi, root, signal) : new Set();
}
export async function stagedDiffForCommitMessage(pi, cwd, signal) {
    return (await collectCommitDiffInput(pi, cwd, undefined, signal)).text;
}
//# sourceMappingURL=git-index-service.js.map