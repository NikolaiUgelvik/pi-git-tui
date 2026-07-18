export type ViewerMutationKind = "stage-file" | "stage-all" | "commit" | "initialize" | "discard" | "branch-switch" | "branch-create" | "stash" | "command";
export type MutationRun<T> = {
    accepted: false;
} | {
    accepted: true;
    value: T;
};
export type DocumentLoadDisposition = "applied" | "superseded";
export type ViewerOperationEvent = {
    type: "mutation-started" | "mutation-rejected" | "mutation-finished";
    kind: ViewerMutationKind;
} | {
    type: "load-started" | "load-applied" | "load-superseded";
    generation: number;
    target: string;
};
export type ViewerOperationObserver = (event: ViewerOperationEvent) => void;
export interface ViewerOperationCoordinatorOptions {
    readonly signal?: AbortSignal;
    readonly onEvent?: ViewerOperationObserver;
}
export declare class ViewerOperationCoordinator {
    private readonly parentSignal;
    private readonly observer;
    private readonly abortFromParent;
    private activeMutation;
    private activeLoad;
    private nextGeneration;
    private latestGeneration;
    private disposed;
    constructor(options?: ViewerOperationCoordinatorOptions);
    get mutationActive(): boolean;
    runMutation<T>(kind: ViewerMutationKind, task: (signal: AbortSignal) => Promise<T>): Promise<MutationRun<T>>;
    applyLatest<T>(target: string, load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, ownerSignal?: AbortSignal): Promise<DocumentLoadDisposition>;
    dispose(): void;
    private isSuperseded;
    private abortActiveLoad;
    private emit;
}
