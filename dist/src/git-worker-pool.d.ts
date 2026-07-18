export interface LinkedAbortController {
    readonly controller: AbortController;
    readonly dispose: () => void;
}
export declare function linkedAbortController(parent?: AbortSignal): LinkedAbortController;
export declare function mapGitWorkers<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number, signal: AbortSignal) => Promise<R>, parentSignal?: AbortSignal): Promise<R[]>;
