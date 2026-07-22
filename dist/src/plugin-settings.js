import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
export const DEFAULT_PLUGIN_SETTINGS = Object.freeze({
    diff: Object.freeze({ wrap: true }),
});
export function copyPluginSettings(settings) {
    return { diff: { wrap: settings.diff.wrap } };
}
function decodedSettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return;
    const diff = value.diff;
    if (!diff || typeof diff !== "object" || Array.isArray(diff))
        return;
    const wrap = diff.wrap;
    return typeof wrap === "boolean" ? { diff: { wrap } } : undefined;
}
function errorCode(error) {
    return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}
export function createPluginSettingsStore(agentDirectory = getAgentDir()) {
    const path = join(agentDirectory, "pi-git-tui.json");
    return {
        path,
        async load() {
            let source;
            try {
                source = await readFile(path, "utf8");
            }
            catch (error) {
                if (errorCode(error) === "ENOENT")
                    return { settings: copyPluginSettings(DEFAULT_PLUGIN_SETTINGS) };
                return {
                    settings: copyPluginSettings(DEFAULT_PLUGIN_SETTINGS),
                    warning: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
            try {
                const settings = decodedSettings(JSON.parse(source));
                if (settings)
                    return { settings };
                return {
                    settings: copyPluginSettings(DEFAULT_PLUGIN_SETTINGS),
                    warning: `Ignored invalid settings in ${path}; expected { "diff": { "wrap": boolean } }`,
                };
            }
            catch (error) {
                return {
                    settings: copyPluginSettings(DEFAULT_PLUGIN_SETTINGS),
                    warning: `Ignored invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        },
        async save(settings) {
            await mkdir(agentDirectory, { recursive: true });
            const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporaryPath, `${JSON.stringify(copyPluginSettings(settings), null, 2)}\n`, {
                    encoding: "utf8",
                    mode: 0o600,
                });
                await rename(temporaryPath, path);
            }
            finally {
                await rm(temporaryPath, { force: true });
            }
        },
    };
}
//# sourceMappingURL=plugin-settings.js.map