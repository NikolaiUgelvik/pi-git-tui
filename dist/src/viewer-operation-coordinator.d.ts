import type { LoadOutcome, LoadSpec, MutationOutcome, MutationSpec, OperationRejectionReason, OperationSnapshot } from "./viewer-operation-types.js";
export type { LoadOutcome, LoadSpec, MutationOutcome, MutationSpec, OperationRejectionReason, OperationSnapshot, RefreshIntent, } from "./viewer-operation-types.js";
export interface CoordinatorOptions {
    currentContext: () => {
        cwd: string;
        generation: number;
    };
    onChange?: (snapshot: OperationSnapshot) => void;
    parentSignal?: AbortSignal;
}
export declare class ViewerOperationCoordinator {
    private active;
    private nextOperationId;
    private pendingRefresh;
    private readonly options;
    private currentSnapshot;
    constructor(options: CoordinatorOptions);
    get snapshot(): OperationSnapshot;
    isBusy(): boolean;
    startBlockReason(): OperationRejectionReason | undefined;
    clearSettled(): void;
    runMutation<T, R = unknown>(spec: MutationSpec<T, R>): Promise<MutationOutcome<T>>;
    runLoad<T>(spec: LoadSpec<T>): Promise<LoadOutcome<T>>;
    retryRefresh(): Promise<LoadOutcome<unknown>>;
    cancelActive(): boolean;
    private begin;
    private executionContext;
    private completionIsStale;
    private tokenIsCurrent;
    private finish;
    private finishStale;
    private storeRefreshFailure;
    private executionRuntime;
    private setSnapshot;
}
