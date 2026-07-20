import { compactGitOutput, requireGitRepository, runGit } from "./git-service.js";
export async function stashCurrentChanges(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const result = await runGit(pi, root, ["stash", "push", "-u", "-m", "WIP from pi-git-tui"], {
        signal,
        timeoutClass: "mutation",
    });
    return compactGitOutput(result) || "Stashed current changes";
}
export async function getStashes(pi, cwd, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    const result = await runGit(pi, root, ["stash", "list", "--format=%gd%x00%s"], { signal });
    return result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
        const [ref = "", message = ""] = line.split("\0");
        return { ref, message };
    });
}
export async function applyStash(pi, cwd, ref, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    await runGit(pi, root, ["stash", "apply", ref], { signal, timeoutClass: "mutation" });
    return `Applied ${ref}`;
}
export async function popStash(pi, cwd, ref, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    await runGit(pi, root, ["stash", "pop", ref], { signal, timeoutClass: "mutation" });
    return `Popped ${ref}`;
}
export async function dropStash(pi, cwd, ref, signal) {
    const root = await requireGitRepository(pi, cwd, signal);
    await runGit(pi, root, ["stash", "drop", ref], { signal, timeoutClass: "mutation" });
    return `Dropped ${ref}`;
}
//# sourceMappingURL=git-stash-service.js.map