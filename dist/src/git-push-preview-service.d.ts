import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GitCompletedResult } from "./git-service.js";
import type { ForcePushPreview, GitCommand } from "./types.js";
export declare function redactPushDestination(destination: string): string;
export declare function parseForcePushPreview(command: GitCommand, args: string[], result: GitCompletedResult): ForcePushPreview;
export declare function previewForcePush(pi: ExtensionAPI, cwd: string, command: GitCommand, signal?: AbortSignal): Promise<ForcePushPreview>;
