import { workingTreeHasConflicts } from "./diff-document.js";
export function commitReviewIntent(document, view) {
    if (document.mode !== "working") {
        return { kind: "blocked", message: "Commit review is only available in the working tree" };
    }
    if (document.repositoryState === "missing") {
        return { kind: "blocked", message: "Initialize a git repository before committing" };
    }
    if (view === "working") {
        return { kind: "review" };
    }
    if (workingTreeHasConflicts(document)) {
        return { kind: "blocked", message: "Resolve conflicts before committing" };
    }
    if (document.staged.stats.files === 0 && document.headState === "unborn") {
        return { kind: "blocked", message: "Stage changes before creating the first commit" };
    }
    return { kind: "dialog" };
}
export function stagingBlockReason(document) {
    if (document.mode !== "working") {
        return "Staging is only available in the working tree";
    }
    if (document.repositoryState === "missing") {
        return "Initialize a git repository before staging changes";
    }
}
//# sourceMappingURL=viewer-index-policy.js.map