import type { Theme } from "@earendil-works/pi-coding-agent"
import {
  matchesKey,
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui"
import { copyPluginSettings, type PluginSettings } from "./plugin-settings.js"

export interface DiffSettingsControllerOptions {
  readonly settingsListTheme: () => SettingsListTheme
  readonly onRequestRender: () => void
  readonly onSave: (settings: PluginSettings) => Promise<void>
  readonly onSaved: (settings: PluginSettings) => void
  readonly theme: Theme
}

type SettingsState = "closed" | "open" | "saving"

export class DiffSettingsController {
  private draft!: PluginSettings
  private error: string | undefined
  private list: SettingsList | undefined
  private state: SettingsState = "closed"

  constructor(private readonly options: DiffSettingsControllerOptions) {}

  isActive(): boolean {
    return this.state !== "closed"
  }

  open(settings: PluginSettings): void {
    this.draft = copyPluginSettings(settings)
    this.error = undefined
    this.state = "open"
    this.list = this.createList()
    this.options.onRequestRender()
  }

  close(): void {
    if (this.state === "saving") return
    this.state = "closed"
    this.error = undefined
    this.list = undefined
    this.options.onRequestRender()
  }

  handleInput(data: string): void {
    if (this.state === "saving") return
    if (matchesKey(data, "ctrl+s")) {
      void this.save()
      return
    }
    this.list?.handleInput(data)
    this.options.onRequestRender()
  }

  hint(): string {
    return this.state === "saving" ? "Saving…" : "Enter/Space: Change • Ctrl+S: Save • Esc: Cancel • F1: Help"
  }

  renderRows(width: number): string[] {
    const rows = this.list?.render(width) ?? []
    if (this.state === "saving") {
      return [this.options.theme.fg("warning", "  Saving settings…"), "", ...rows]
    }
    if (!this.error) return rows
    const errorRows = wrapTextWithAnsi(`Could not save settings: ${this.error}`, Math.max(1, width - 4)).map((row) =>
      this.options.theme.fg("warning", `  ${row}`),
    )
    return [...errorRows, "", ...rows]
  }

  invalidate(): void {
    if (this.isActive()) this.list = this.createList()
  }

  private createList(): SettingsList {
    const items: SettingItem[] = [
      {
        id: "diff-wrap",
        label: "Wrap diff lines",
        description: "Wrap long diff lines to the panel width instead of scrolling horizontally",
        currentValue: this.draft.diff.wrap ? "on" : "off",
        values: ["on", "off"],
      },
    ]
    return new SettingsList(
      items,
      items.length,
      this.options.settingsListTheme(),
      (id, value) => {
        if (id === "diff-wrap") this.draft = { diff: { wrap: value === "on" } }
        this.error = undefined
        this.options.onRequestRender()
      },
      () => this.close(),
    )
  }

  private async save(): Promise<void> {
    const settings = copyPluginSettings(this.draft)
    this.error = undefined
    this.state = "saving"
    this.options.onRequestRender()
    try {
      await this.options.onSave(settings)
      this.options.onSaved(settings)
      this.state = "open"
      this.close()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.state = "open"
      this.options.onRequestRender()
    }
  }
}
