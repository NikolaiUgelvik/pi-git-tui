import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
  loadWorkingTreeDiff,
  loadWorkingTreeDiffFromSnapshot,
  workingTreeDocumentSubtitle,
  workingTreeDocumentTitle,
  workingTreeRevision,
} from "./git-diff-service.js"
import { loadWorkingTreeSnapshot } from "./git-status.js"
import { workingTreeContentIdentity } from "./git-working-tree-identity.js"
import type { DiffDocument, WorkingTreeRefreshScope } from "./types.js"

export type WorkingTreeRefreshReason =
  | "none"
  | "status-unchanged"
  | "requested-full"
  | "status-changed"
  | "missing-revision"
  | "unsafe-dirty-baseline"
  | "content-changed"

export interface WorkingTreeRefreshResult {
  readonly document: DiffDocument
  readonly appliedScope: WorkingTreeRefreshScope
  readonly reason: WorkingTreeRefreshReason
}

async function fullRefresh(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  reason: Exclude<WorkingTreeRefreshReason, "none" | "status-unchanged">,
): Promise<WorkingTreeRefreshResult> {
  return {
    document: await loadWorkingTreeDiff(pi, ctx),
    appliedScope: "full",
    reason,
  }
}

export async function refreshWorkingTreeDocument(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  current: DiffDocument,
  requested: WorkingTreeRefreshScope,
): Promise<WorkingTreeRefreshResult> {
  if (requested === "none" || current.mode !== "working") {
    return { document: current, appliedScope: "none", reason: "none" }
  }
  if (requested === "full") {
    return fullRefresh(pi, ctx, "requested-full")
  }

  const revision = current.revision
  if (!revision) {
    return fullRefresh(pi, ctx, "missing-revision")
  }
  const snapshot = await loadWorkingTreeSnapshot(pi, revision.root, ctx.signal)
  if (snapshot.statusFingerprint !== revision.statusFingerprint) {
    return {
      document: await loadWorkingTreeDiffFromSnapshot(pi, revision.root, snapshot, ctx.signal),
      appliedScope: "full",
      reason: "status-changed",
    }
  }

  const contentIdentity = snapshot.clean
    ? revision.contentIdentity
    : await workingTreeContentIdentity(revision.root, snapshot, ctx.signal)
  if (contentIdentity !== revision.contentIdentity) {
    return {
      document: await loadWorkingTreeDiffFromSnapshot(pi, revision.root, snapshot, ctx.signal),
      appliedScope: "full",
      reason: "content-changed",
    }
  }

  return {
    document: {
      ...current,
      title: workingTreeDocumentTitle(snapshot),
      subtitle: workingTreeDocumentSubtitle(revision.root, snapshot),
      revision: workingTreeRevision(revision.root, snapshot, contentIdentity),
    },
    appliedScope: "status",
    reason: "status-unchanged",
  }
}
