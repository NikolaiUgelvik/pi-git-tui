import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DiffDocument } from "./types.js";
import type { DiffLoadRequest } from "./viewer-document-state.js";
export declare function contextForDocumentLoad(context: ExtensionContext, cwd: string, signal?: AbortSignal): ExtensionContext;
export declare function loadDiffDocument(pi: ExtensionAPI, context: ExtensionContext, request: DiffLoadRequest, signal?: AbortSignal): Promise<DiffDocument>;
