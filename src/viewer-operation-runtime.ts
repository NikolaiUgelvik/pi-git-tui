import type { FailureDetails } from "./failure-details.js"
import type {
  MutationOutcome,
  OperationExecutionContext,
  OperationSnapshot,
  OperationToken,
  RefreshIntent,
} from "./viewer-operation-types.js"

export interface ActiveOperation {
  token: OperationToken
  kind: "mutation" | "load" | "retry"
  phase: "mutation" | "refresh" | "load" | "retry" | "reconcile"
  controller: AbortController
  cancelRequested: boolean
}

export interface OperationExecutionRuntime {
  executionContext: (active: ActiveOperation) => OperationExecutionContext
  completionIsStale: (active: ActiveOperation) => boolean
  finish: (active: ActiveOperation, snapshot: OperationSnapshot) => void
  finishStale: <T>(active: ActiveOperation, mutation?: T) => MutationOutcome<T>
  setSnapshot: (snapshot: OperationSnapshot) => void
  storeRefreshFailure: <T>(
    active: ActiveOperation,
    intent: RefreshIntent<T>,
    failure: FailureDetails,
    completion: OperationSnapshot,
    failedSummary: string,
    successMessage?: string,
  ) => void
  clearPendingRefresh: () => void
}
