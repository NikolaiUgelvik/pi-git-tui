import { compactGitOutput, ensureGitRepository, runGit } from "./git-service.js";
export async function runGitCommand(pi, cwd, command, signal) {
    const root = await ensureGitRepository(pi, cwd, signal);
    if (!root)
        throw new Error("Not a git repository");
    const result = await runGit(pi, root, command.args, { signal, timeoutClass: "network" });
    const output = compactGitOutput(result);
    return output ? `${command.label} complete: ${output}` : `${command.label} complete`;
}
//# sourceMappingURL=git-command-service.js.map