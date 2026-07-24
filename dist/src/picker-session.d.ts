export type PickerRequest = {
    readonly generation: number;
};
export declare class PickerSession<S extends string> {
    private generation;
    private phase;
    private message;
    private returnState;
    get state(): "closed" | "loading" | S;
    get loadingMessage(): string | undefined;
    transition(state: S | "closed"): void;
    beginLoading(message: string, returnState: S | "closed"): PickerRequest;
    isCurrent(request: PickerRequest): boolean;
    finish(request: PickerRequest, state: S | "closed"): boolean;
    cancelLoading(): S | "closed";
    updateLoadingMessage(message: string): void;
    close(): {
        readonly wasLoading: boolean;
    };
}
