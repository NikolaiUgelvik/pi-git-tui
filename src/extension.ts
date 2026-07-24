import { type ExtensionAPI, type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent"
import { loadWorkingTreeDocument } from "./git.js"
import { isGitAbortError } from "./git-service.js"
import { createPluginSettingsStore } from "./plugin-settings.js"
import { DiffViewer } from "./viewer.js"
import { failedViewerDocument, loadedViewerDocument, type ViewerInitialDocument } from "./viewer-document-state.js"

const diffDescription = "Open an interactive git diff and commit viewer"

export async function openDiffViewer(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/diff requires interactive mode", "error")
    return
  }

  if (ctx.signal?.aborted) return

  const settingsStore = createPluginSettingsStore()
  const request = { kind: "working" as const, cwd: ctx.cwd }
  const initialDocumentPromise = (async (): Promise<ViewerInitialDocument | undefined> => {
    try {
      return loadedViewerDocument(await loadWorkingTreeDocument(pi, ctx), request)
    } catch (error) {
      if (isGitAbortError(error) || ctx.signal?.aborted) return
      return failedViewerDocument(request, error)
    }
  })()
  const [loadedSettings, initialDocument] = await Promise.all([settingsStore.load(), initialDocumentPromise])
  if (!initialDocument) return
  if (loadedSettings.warning) ctx.ui.notify(loadedSettings.warning, "warning")

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
        {
          settings: loadedSettings.settings,
          settingsListTheme: getSettingsListTheme,
          saveSettings: (settings) => settingsStore.save(settings),
        },
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
}
