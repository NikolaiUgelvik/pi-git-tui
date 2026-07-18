import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { KeyId } from "@earendil-works/pi-tui"
import { loadWorkingTreeDocument } from "./git.js"
import { DiffViewer } from "./viewer.js"
import { failedViewerDocument, loadedViewerDocument, type ViewerInitialDocument } from "./viewer-document-state.js"

const diffDescription = "Open an interactive git diff and commit viewer"

export function getDiffShortcut(platform: NodeJS.Platform = process.platform): KeyId {
  return platform === "darwin" ? "super+shift+g" : "ctrl+shift+g"
}

export async function openDiffViewer(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/diff requires interactive mode", "error")
    return
  }

  const request = { kind: "working" as const, cwd: ctx.cwd }
  let initialDocument: ViewerInitialDocument
  try {
    initialDocument = loadedViewerDocument(await loadWorkingTreeDocument(pi, ctx), request)
  } catch (error) {
    initialDocument = failedViewerDocument(request, error)
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
      void viewer.focused
      viewer.focused = false
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
