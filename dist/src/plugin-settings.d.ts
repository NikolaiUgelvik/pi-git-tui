export interface PluginSettings {
    readonly diff: {
        readonly wrap: boolean;
    };
}
export interface LoadedPluginSettings {
    readonly settings: PluginSettings;
    readonly warning?: string;
}
export interface PluginSettingsStore {
    readonly path: string;
    load: () => Promise<LoadedPluginSettings>;
    save: (settings: PluginSettings) => Promise<void>;
}
export declare const DEFAULT_PLUGIN_SETTINGS: PluginSettings;
export declare function copyPluginSettings(settings: PluginSettings): PluginSettings;
export declare function createPluginSettingsStore(agentDirectory?: string): PluginSettingsStore;
