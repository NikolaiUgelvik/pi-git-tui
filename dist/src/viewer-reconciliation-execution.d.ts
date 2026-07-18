import { failureDetails } from "./failure-details.js";
import type { ActiveOperation, OperationExecutionRuntime } from "./viewer-operation-runtime.js";
import type { LoadOutcome, MutationOutcome, RefreshIntent } from "./viewer-operation-types.js";
import { type PendingRefresh } from "./viewer-refresh-recovery.js";
export declare function reconcileCancellation<T, R>(runtime: OperationExecutionRuntime, active: ActiveOperation, intent: RefreshIntent<R>, mutation?: T, successMessage?: string): Promise<MutationOutcome<T>>;
export declare function reconcileMutationFailure<T, R>(runtime: OperationExecutionRuntime, active: ActiveOperation, intent: RefreshIntent<R>, mutationFailure: ReturnType<typeof failureDetails>): Promise<MutationOutcome<T>>;
export declare function executeRefreshRetry(runtime: OperationExecutionRuntime, active: ActiveOperation, pending: PendingRefresh): Promise<LoadOutcome<unknown>>;
