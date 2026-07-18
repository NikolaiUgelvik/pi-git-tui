import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GitRunOptions } from "./git-service.js";
export declare function withGitOutputFile<T>(pi: ExtensionAPI, cwd: string, args: (outputPath: string) => readonly string[], consume: (outputPath: string) => Promise<T>, options?: GitRunOptions): Promise<T>;
export declare function readNulRecords(outputPath: string, signal?: AbortSignal): AsyncGenerator<string>;
export declare function readPatchChunks(outputPath: string, signal?: AbortSignal): AsyncGenerator<string>;
