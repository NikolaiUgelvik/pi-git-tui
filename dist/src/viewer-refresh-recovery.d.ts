import type { FailureDetails } from "./failure-details.js";
import type { OperationSnapshot, OperationToken, RefreshIntent } from "./viewer-operation-types.js";
export interface PendingRefresh {
    intent: RefreshIntent<unknown>;
    failedSummary: string;
    failure: FailureDetails;
    origin: Pick<OperationToken, "cwd" | "generation">;
    successMessage?: string;
    completion: OperationSnapshot;
}
export declare function refreshFailureSnapshot(pending: PendingRefresh): OperationSnapshot;
export declare function combinedRefreshFailure(primary: FailureDetails, secondary: FailureDetails): FailureDetails;
export declare function erasedRefreshIntent<T>(intent: RefreshIntent<T>): RefreshIntent<unknown>;
