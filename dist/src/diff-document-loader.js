import { loadCommitDocument, loadWorkingTreeDocument } from "./git.js";
export function contextForDocumentLoad(context, cwd, signal) {
    return { ...context, cwd, signal: signal ?? context.signal };
}
export async function loadDiffDocument(pi, context, request, signal) {
    if (request.kind === "commit") {
        return loadCommitDocument(pi, { cwd: request.cwd, commit: request.commit, signal });
    }
    return loadWorkingTreeDocument(pi, contextForDocumentLoad(context, request.cwd, signal));
}
//# sourceMappingURL=diff-document-loader.js.map