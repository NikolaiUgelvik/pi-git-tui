import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { emptyDocument } from "./diff-parser.js"
import { loadWorkingTreeDiff } from "./git.js"
import type { DiffDocument } from "./types.js"
import { DiffViewer } from "./viewer.js"

export default function gitDiffExtension(pi: ExtensionAPI) {
  pi.registerCommand("diff", {
    description: "Open an interactive git diff and commit viewer",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/diff requires interactive mode", "error")
        return
      }

      let initialDocument: DiffDocument
      try {
        initialDocument = await loadWorkingTreeDiff(pi, ctx)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        initialDocument = emptyDocument("Failed to load git diff", message, "working")
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          const viewer = new DiffViewer(
            pi,
            ctx,
            theme,
            initialDocument,
            () => done(undefined),
            () => tui.requestRender(),
            () => tui.terminal.rows,
          )
          void viewer.handleInput
          void viewer.invalidate
          return viewer
        },
        {
          overlay: true,
          overlayOptions: {
            width: "100%",
            maxHeight: "100%",
            anchor: "center",
            margin: 1,
          },
        },
      )
    },
  })
}
