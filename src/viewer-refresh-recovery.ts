import type { FailureDetails } from "./failure-details.js"
import type { OperationSnapshot, OperationToken, RefreshIntent } from "./viewer-operation-types.js"

export interface PendingRefresh {
  intent: RefreshIntent<unknown>
  failedSummary: string
  failure: FailureDetails
  origin: Pick<OperationToken, "cwd" | "generation">
  successMessage?: string
  completion: OperationSnapshot
}

export function refreshFailureSnapshot(pending: PendingRefresh): OperationSnapshot {
  return {
    state: "refreshFailed",
    label: pending.intent.label,
    summary: pending.failedSummary,
    successMessage: pending.successMessage,
    failure: pending.failure,
    canRetryRefresh: true,
  }
}

export function combinedRefreshFailure(primary: FailureDetails, secondary: FailureDetails): FailureDetails {
  return {
    summary: secondary.summary,
    details: `${primary.details}\n\nReconciliation/refresh failure:\n${secondary.details}`,
    cause: secondary.cause,
  }
}

export function erasedRefreshIntent<T>(intent: RefreshIntent<T>): RefreshIntent<unknown> {
  return {
    ...intent,
    apply: (value: unknown, token: OperationToken) => intent.apply(value as T, token),
  }
}
