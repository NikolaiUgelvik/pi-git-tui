function linkedController(...inputs) {
    const controller = new AbortController();
    const parents = [...new Set(inputs.filter((signal) => signal !== undefined))];
    const abort = () => controller.abort(parents.find((signal) => signal.aborted)?.reason);
    if (parents.some((signal) => signal.aborted)) {
        abort();
    }
    else {
        for (const parent of parents)
            parent.addEventListener("abort", abort, { once: true });
    }
    return {
        controller,
        dispose: () => {
            for (const parent of parents)
                parent.removeEventListener("abort", abort);
        },
    };
}
export class ViewerOperationCoordinator {
    parentSignal;
    observer;
    abortFromParent = () => this.dispose();
    activeMutation;
    activeLoad;
    nextGeneration = 0;
    latestGeneration = 0;
    disposed = false;
    constructor(options = {}) {
        this.parentSignal = options.signal;
        this.observer = options.onEvent;
        if (this.parentSignal?.aborted) {
            this.disposed = true;
        }
        else {
            this.parentSignal?.addEventListener("abort", this.abortFromParent, { once: true });
        }
    }
    get mutationActive() {
        return this.activeMutation !== undefined;
    }
    async runMutation(kind, task) {
        if (this.disposed || this.activeMutation) {
            this.emit({ type: "mutation-rejected", kind });
            return { accepted: false };
        }
        this.latestGeneration = ++this.nextGeneration;
        this.abortActiveLoad();
        const linked = linkedController(this.parentSignal);
        this.activeMutation = linked;
        this.emit({ type: "mutation-started", kind });
        try {
            return { accepted: true, value: await task(linked.controller.signal) };
        }
        finally {
            linked.dispose();
            if (this.activeMutation === linked) {
                this.activeMutation = undefined;
            }
            this.emit({ type: "mutation-finished", kind });
        }
    }
    async applyLatest(target, load, apply, ownerSignal) {
        const generation = ++this.nextGeneration;
        this.emit({ type: "load-started", generation, target });
        if (this.disposed ||
            ownerSignal?.aborted ||
            (this.activeMutation !== undefined && ownerSignal !== this.activeMutation.controller.signal)) {
            this.emit({ type: "load-superseded", generation, target });
            return "superseded";
        }
        this.latestGeneration = generation;
        this.abortActiveLoad();
        const linked = linkedController(this.parentSignal, ownerSignal);
        this.activeLoad = linked;
        try {
            const value = await load(linked.controller.signal);
            if (this.isSuperseded(generation, linked)) {
                this.emit({ type: "load-superseded", generation, target });
                return "superseded";
            }
            apply(value);
            this.emit({ type: "load-applied", generation, target });
            return "applied";
        }
        catch (error) {
            if (this.isSuperseded(generation, linked)) {
                this.emit({ type: "load-superseded", generation, target });
                return "superseded";
            }
            throw error;
        }
        finally {
            linked.dispose();
            if (this.activeLoad === linked) {
                this.activeLoad = undefined;
            }
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.parentSignal?.removeEventListener("abort", this.abortFromParent);
        this.activeMutation?.controller.abort();
        this.abortActiveLoad();
    }
    isSuperseded(generation, linked) {
        return this.disposed || generation !== this.latestGeneration || linked.controller.signal.aborted;
    }
    abortActiveLoad() {
        this.activeLoad?.controller.abort();
        this.activeLoad?.dispose();
        this.activeLoad = undefined;
    }
    emit(event) {
        try {
            this.observer?.(event);
        }
        catch {
            // Instrumentation must not affect viewer behavior.
        }
    }
}
//# sourceMappingURL=viewer-operation-coordinator.js.map