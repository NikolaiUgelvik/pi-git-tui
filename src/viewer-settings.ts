import type { Theme } from "@earendil-works/pi-coding-agent"
import type { SettingsListTheme } from "@earendil-works/pi-tui"
import { DiffSettingsController } from "./diff-settings-controller.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import type { PluginSettings } from "./plugin-settings.js"
import type { ViewerOverlayFeature } from "./viewer-overlay-coordinator.js"

export interface SettingsFeatureOptions {
  readonly theme: Theme
  readonly settingsListTheme: () => SettingsListTheme
  readonly currentSettings: () => PluginSettings
  readonly canOpen: () => boolean
  readonly save: (settings: PluginSettings) => Promise<void>
  readonly saved: (settings: PluginSettings) => void
  readonly requestRender: () => void
  readonly renderPicker: (
    baseLines: string[],
    width: number,
    render: (lineCount: number, width: number) => string[],
  ) => string[]
}

export function createSettingsFeature(options: SettingsFeatureOptions): ViewerOverlayFeature {
  const controller = new DiffSettingsController({
    settingsListTheme: options.settingsListTheme,
    onRequestRender: options.requestRender,
    onSave: options.save,
    onSaved: options.saved,
    theme: options.theme,
  })

  return {
    kind: "settings",
    adapter: {
      isActive: () => controller.isActive(),
      activeTextField: () => undefined,
      helpContext: () => "settings",
      render: (baseLines, width) =>
        options.renderPicker(baseLines, width, (baseLineCount, overlayWidth) => {
          const frame = createOverlayFrame(baseLineCount, overlayWidth, options.theme)
          return renderOverlayFrame(
            frame,
            ` ${options.theme.fg("accent", options.theme.bold("Pi Git TUI settings"))}`,
            ` ${options.theme.fg("dim", controller.hint())}`,
            controller.renderRows(frame.innerWidth),
          )
        }),
      handleInput: (data) => controller.handleInput(data),
      handleOpen: (data) => {
        if (data !== "S") return false
        if (options.canOpen()) controller.open(options.currentSettings())
        return true
      },
      close: () => controller.close(),
    },
    invalidate: () => controller.invalidate(),
  }
}
