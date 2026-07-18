import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { loadCommitDocument, loadWorkingTreeDocument } from "./git.js"
import type { DiffDocument } from "./types.js"
import type { DiffLoadRequest } from "./viewer-document-state.js"

export function contextForDocumentLoad(context: ExtensionContext, cwd: string, signal?: AbortSignal): ExtensionContext {
  return { ...context, cwd, signal: signal ?? context.signal }
}

export async function loadDiffDocument(
  pi: ExtensionAPI,
  context: ExtensionContext,
  request: DiffLoadRequest,
  signal?: AbortSignal,
): Promise<DiffDocument> {
  if (request.kind === "commit") {
    return loadCommitDocument(pi, { cwd: request.cwd, commit: request.commit, signal })
  }
  return loadWorkingTreeDocument(pi, contextForDocumentLoad(context, request.cwd, signal))
}
