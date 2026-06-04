import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { KeyId } from "@earendil-works/pi-tui"
import { emptyDocument } from "./diff-parser.js"
import { loadWorkingTreeDiff } from "./git.js"
import type { DiffDocument } from "./types.js"
import { DiffViewer } from "./viewer.js"

const diffDescription = "Open an interactive git diff and commit viewer"

export function getDiffShortcut(platform: NodeJS.Platform = process.platform): KeyId {
  return platform === "darwin" ? "super+shift+g" : "ctrl+shift+g"
}

async function openDiffViewer(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
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
}

export default function gitDiffExtension(pi: ExtensionAPI) {
  pi.registerCommand("diff", {
    description: diffDescription,
    handler: async (_args, ctx) => openDiffViewer(pi, ctx),
  })

  pi.registerShortcut(getDiffShortcut(), {
    description: diffDescription,
    handler: async (ctx) => openDiffViewer(pi, ctx),
  })
}
