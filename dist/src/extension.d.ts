import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
export declare function getDiffShortcut(platform?: NodeJS.Platform): KeyId;
export declare function openDiffViewer(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void>;
export default function gitDiffExtension(pi: ExtensionAPI): void;
