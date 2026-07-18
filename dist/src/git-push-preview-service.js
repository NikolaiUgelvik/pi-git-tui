import { assertGitSuccess, probeGit, requireGitRepository } from "./git-service.js";
class ForcePushPreviewError extends Error {
    details;
    constructor(message, details) {
        super(message);
        this.name = "ForcePushPreviewError";
        this.details = details;
    }
}
export function redactPushDestination(destination) {
    return destination.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, "$1");
}
function redactedPushResult(result) {
    return {
        ...result,
        stdout: redactPushDestination(result.stdout),
        stderr: redactPushDestination(result.stderr),
    };
}
export function parseForcePushPreview(command, args, result) {
    const safeResult = redactedPushResult(result);
    const lines = [safeResult.stdout, safeResult.stderr]
        .join("\n")
        .split(/\r?\n/gu)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    const destinationLine = lines.find((line) => /^To\s+/u.test(line));
    const destination = destinationLine?.replace(/^To\s+/u, "").trim();
    if (!destination) {
        const details = [
            `Command: git ${args.join(" ")}`,
            "Git completed the dry run without reporting a push destination.",
            safeResult.stdout ? `\nstdout:\n${safeResult.stdout.trimEnd()}` : "",
            safeResult.stderr ? `\nstderr:\n${safeResult.stderr.trimEnd()}` : "",
        ]
            .filter(Boolean)
            .join("\n");
        throw new ForcePushPreviewError("Force-push destination could not be resolved", details);
    }
    return {
        command: `git ${command.args.join(" ")}`,
        destination: redactPushDestination(destination),
        updates: lines.flatMap(parsePorcelainUpdate),
    };
}
function parsePorcelainUpdate(line) {
    const fields = line.split("\t");
    if (fields.length < 3 || fields[0] === undefined || fields[1] === undefined) {
        return [];
    }
    const separator = fields[1].indexOf(":");
    if (separator < 0) {
        return [];
    }
    return [
        {
            flag: fields[0] || " ",
            source: fields[1].slice(0, separator),
            destination: fields[1].slice(separator + 1),
            summary: fields.slice(2).join("\t"),
        },
    ];
}
export async function previewForcePush(pi, cwd, command, signal) {
    if (command.risk.kind !== "force-push") {
        throw new Error(`${command.label} does not require a force-push preview`);
    }
    const root = await requireGitRepository(pi, cwd, signal);
    const args = [...command.args, "--dry-run", "--porcelain"];
    const result = redactedPushResult(await probeGit(pi, root, args, { signal, timeoutClass: "network" }));
    assertGitSuccess(result, args, root);
    return parseForcePushPreview(command, args, result);
}
//# sourceMappingURL=git-push-preview-service.js.map