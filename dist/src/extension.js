import { loadWorkingTreeDocument } from "./git.js";
import { isGitAbortError } from "./git-service.js";
import { DiffViewer } from "./viewer.js";
import { failedViewerDocument, loadedViewerDocument } from "./viewer-document-state.js";
const diffDescription = "Open an interactive git diff and commit viewer";
export function getDiffShortcut(platform = process.platform) {
    return platform === "darwin" ? "super+shift+g" : "ctrl+shift+g";
}
export async function openDiffViewer(pi, ctx) {
    if (!ctx.hasUI) {
        ctx.ui.notify("/diff requires interactive mode", "error");
        return;
    }
    if (ctx.signal?.aborted)
        return;
    const request = { kind: "working", cwd: ctx.cwd };
    let initialDocument;
    try {
        initialDocument = loadedViewerDocument(await loadWorkingTreeDocument(pi, ctx), request);
    }
    catch (error) {
        if (isGitAbortError(error) || ctx.signal?.aborted)
            return;
        initialDocument = failedViewerDocument(request, error);
    }
    await ctx.ui.custom((tui, theme, _keybindings, done) => {
        const viewer = new DiffViewer(pi, ctx, theme, initialDocument, () => done(undefined), () => tui.requestRender(), () => tui.terminal.rows);
        void viewer.handleInput;
        void viewer.invalidate;
        void viewer.focused;
        viewer.focused = false;
        return viewer;
    }, {
        overlay: true,
        overlayOptions: {
            width: "100%",
            maxHeight: "100%",
            anchor: "center",
            margin: 1,
        },
    });
}
export default function gitDiffExtension(pi) {
    pi.registerCommand("diff", {
        description: diffDescription,
        handler: async (_args, ctx) => openDiffViewer(pi, ctx),
    });
    pi.registerShortcut(getDiffShortcut(), {
        description: diffDescription,
        handler: async (ctx) => openDiffViewer(pi, ctx),
    });
}
//# sourceMappingURL=extension.js.map