import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]>;
export declare function listStagedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<Set<string>>;
