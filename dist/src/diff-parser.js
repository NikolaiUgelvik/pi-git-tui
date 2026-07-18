import { parseDiff } from "./diff-parser-core.js";
import { textLineCount, utf8Bytes } from "./git-patch.js";
export function emptyDocument(title, subtitle, mode, commit, repositoryState) {
    return {
        mode,
        title,
        subtitle,
        raw: "",
        files: [],
        omittedFileCount: 0,
        capturedPatchBytes: 0,
        capturedPatchLines: 0,
        commit,
        repositoryState,
    };
}
export function buildDocument(mode, title, subtitle, raw, commit, stagedPaths = new Set(), conflictedPaths = new Set(), untrackedPaths = new Set()) {
    const files = parseDiff(raw).map((file) => {
        const untracked = untrackedPaths.has(file.path);
        return {
            ...file,
            status: conflictedPaths.has(file.path)
                ? "conflicted"
                : untracked && file.status === "modified"
                    ? "added"
                    : file.status,
            staged: stagedPaths.has(file.path),
            untracked: untracked || undefined,
        };
    });
    return {
        mode,
        title,
        subtitle,
        raw,
        files,
        omittedFileCount: 0,
        capturedPatchBytes: utf8Bytes(raw),
        capturedPatchLines: textLineCount(raw),
        commit,
    };
}
//# sourceMappingURL=diff-parser.js.map