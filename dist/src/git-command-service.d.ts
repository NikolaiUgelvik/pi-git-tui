import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GitCommand } from "./types.js";
export declare function runGitCommand(pi: ExtensionAPI, cwd: string, command: GitCommand, signal?: AbortSignal): Promise<string>;
