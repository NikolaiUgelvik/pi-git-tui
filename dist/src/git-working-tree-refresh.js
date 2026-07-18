import { loadWorkingTreeDiff, loadWorkingTreeDiffFromSnapshot, workingTreeDocumentSubtitle, workingTreeDocumentTitle, workingTreeRevision, } from "./git-diff-service.js";
import { loadWorkingTreeSnapshot } from "./git-status.js";
import { workingTreeContentIdentity } from "./git-working-tree-identity.js";
async function fullRefresh(pi, ctx, reason) {
    return {
        document: await loadWorkingTreeDiff(pi, ctx),
        appliedScope: "full",
        reason,
    };
}
export async function refreshWorkingTreeDocument(pi, ctx, current, requested) {
    if (requested === "none" || current.mode !== "working") {
        return { document: current, appliedScope: "none", reason: "none" };
    }
    if (requested === "full") {
        return fullRefresh(pi, ctx, "requested-full");
    }
    const revision = current.revision;
    if (!revision) {
        return fullRefresh(pi, ctx, "missing-revision");
    }
    const snapshot = await loadWorkingTreeSnapshot(pi, revision.root, ctx.signal);
    if (snapshot.statusFingerprint !== revision.statusFingerprint) {
        return {
            document: await loadWorkingTreeDiffFromSnapshot(pi, revision.root, snapshot, ctx.signal),
            appliedScope: "full",
            reason: "status-changed",
        };
    }
    const contentIdentity = snapshot.clean
        ? revision.contentIdentity
        : await workingTreeContentIdentity(revision.root, snapshot, ctx.signal);
    if (contentIdentity !== revision.contentIdentity) {
        return {
            document: await loadWorkingTreeDiffFromSnapshot(pi, revision.root, snapshot, ctx.signal),
            appliedScope: "full",
            reason: "content-changed",
        };
    }
    return {
        document: {
            ...current,
            title: workingTreeDocumentTitle(snapshot),
            subtitle: workingTreeDocumentSubtitle(revision.root, snapshot),
            revision: workingTreeRevision(revision.root, snapshot, contentIdentity),
        },
        appliedScope: "status",
        reason: "status-unchanged",
    };
}
//# sourceMappingURL=git-working-tree-refresh.js.map