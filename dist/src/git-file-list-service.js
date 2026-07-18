import { runGit } from "./git-service.js";
export async function listUntrackedFiles(pi, cwd, signal) {
    const result = await runGit(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { signal });
    return result.stdout ? result.stdout.split("\0").filter(Boolean) : [];
}
export async function listStagedFiles(pi, cwd, signal) {
    const result = await runGit(pi, cwd, ["diff", "--cached", "--name-only", "-z"], { signal });
    return new Set(result.stdout ? result.stdout.split("\0").filter(Boolean) : []);
}
//# sourceMappingURL=git-file-list-service.js.map