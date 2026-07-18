import type { FailureDetails } from "./failure-details.js"
import type { DocumentSelection } from "./viewer-document-state.js"

export type OperationState =
  | "idle"
  | "running"
  | "cancelling"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "refreshFailed"

export interface OperationToken {
  id: number
  cwd: string
  generation: number
}

export interface OperationExecutionContext {
  token: OperationToken
  signal: AbortSignal
}

export interface RefreshIntent<T = unknown> {
  label: string
  selection?: DocumentSelection
  run: (context: OperationExecutionContext) => Promise<T>
  apply: (value: T, token: OperationToken) => void
}

export interface OperationSnapshot {
  state: OperationState
  label?: string
  summary?: string
  successMessage?: string
  failure?: FailureDetails
  token?: OperationToken
  canRetryRefresh: boolean
}

export type OperationRejectionReason = "busy" | "refreshRequired"

export type MutationOutcome<T> =
  | { kind: "succeeded"; mutation: T; token: OperationToken }
  | { kind: "mutationFailed"; failure: FailureDetails; reconciled: boolean; token: OperationToken }
  | { kind: "refreshFailed"; mutation?: T; failure: FailureDetails; token: OperationToken }
  | { kind: "cancelled"; mutation?: T; reconciled: boolean; token: OperationToken }
  | { kind: "stale"; mutation?: T; token: OperationToken }
  | { kind: "rejected"; reason: OperationRejectionReason }

export type LoadOutcome<T> =
  | { kind: "succeeded"; value: T; token: OperationToken }
  | { kind: "failed"; failure: FailureDetails; token: OperationToken }
  | { kind: "cancelled"; token: OperationToken }
  | { kind: "stale"; token: OperationToken }
  | { kind: "rejected"; reason: OperationRejectionReason }

export interface MutationSpec<T, R = unknown> {
  label: string
  runningMessage: string
  mutate: (context: OperationExecutionContext) => Promise<T>
  successMessage: (value: T) => string
  refresh: RefreshIntent<R>
  refreshAfterSuccess?: boolean
  reconcileOnFailure?: boolean
}

export interface LoadSpec<T> {
  label: string
  runningMessage: string
  load: (context: OperationExecutionContext) => Promise<T>
  apply: (value: T, token: OperationToken) => void
  successMessage?: (value: T) => string
  reportFailure?: boolean
}
