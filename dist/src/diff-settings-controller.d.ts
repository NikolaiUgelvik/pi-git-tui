import type { Theme } from "@earendil-works/pi-coding-agent";
import { type SettingsListTheme } from "@earendil-works/pi-tui";
import { type PluginSettings } from "./plugin-settings.js";
export interface DiffSettingsControllerOptions {
    readonly settingsListTheme: () => SettingsListTheme;
    readonly onRequestRender: () => void;
    readonly onSave: (settings: PluginSettings) => Promise<void>;
    readonly onSaved: (settings: PluginSettings) => void;
    readonly theme: Theme;
}
export declare class DiffSettingsController {
    private readonly options;
    private draft;
    private error;
    private list;
    private state;
    constructor(options: DiffSettingsControllerOptions);
    isActive(): boolean;
    open(settings: PluginSettings): void;
    close(): void;
    handleInput(data: string): void;
    hint(): string;
    renderRows(width: number): string[];
    invalidate(): void;
    private createList;
    private save;
}
