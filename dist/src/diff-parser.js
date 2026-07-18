import { buildCommitDocument, buildWorkingTreeDocument, emptyWorkingTreeDocument, selectDiffSlice, } from "./diff-document.js";
export function emptyDocument(title, subtitle, mode, commit, repositoryState = "ready", headState = "present") {
    if (mode === "commit") {
        return buildCommitDocument({
            title,
            subtitle,
            raw: "",
            commit: commit ?? { hash: "", message: "" },
            headState,
        });
    }
    return emptyWorkingTreeDocument(title, subtitle, repositoryState, headState);
}
export function buildDocument(mode, title, subtitle, raw, commit, stagedPaths = new Set(), conflictedPaths = new Set(), untrackedPaths = new Set(), repositoryState = "ready", headState = "present") {
    if (mode === "commit") {
        return buildCommitDocument({ title, subtitle, raw, commit: commit ?? { hash: "", message: "" }, headState });
    }
    const document = buildWorkingTreeDocument({
        title,
        subtitle,
        workingRaw: raw,
        stagedRaw: "",
        conflictedPaths,
        untrackedPaths,
        repositoryState,
        headState,
    });
    applyLegacyStagedPaths(document, stagedPaths);
    return document;
}
function applyLegacyStagedPaths(document, stagedPaths) {
    if (stagedPaths.size === 0) {
        return;
    }
    for (const file of selectDiffSlice(document, "working").files) {
        if (stagedPaths.has(file.path)) {
            file.stageState = "staged";
        }
    }
}
//# sourceMappingURL=diff-parser.js.map