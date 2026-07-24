import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";
import type { PluginSettings } from "./plugin-settings.js";
import type { ViewerOverlayFeature } from "./viewer-overlay-coordinator.js";
export interface SettingsFeatureOptions {
    readonly theme: Theme;
    readonly settingsListTheme: () => SettingsListTheme;
    readonly currentSettings: () => PluginSettings;
    readonly canOpen: () => boolean;
    readonly save: (settings: PluginSettings) => Promise<void>;
    readonly saved: (settings: PluginSettings) => void;
    readonly requestRender: () => void;
    readonly renderPicker: (baseLines: string[], width: number, render: (lineCount: number, width: number) => string[]) => string[];
}
export declare function createSettingsFeature(options: SettingsFeatureOptions): ViewerOverlayFeature;
