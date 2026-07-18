import { executeLoad } from "./viewer-load-execution.js";
import { executeMutation } from "./viewer-mutation-execution.js";
import { executeRefreshRetry } from "./viewer-reconciliation-execution.js";
import { erasedRefreshIntent } from "./viewer-refresh-recovery.js";
export class ViewerOperationCoordinator {
    active;
    nextOperationId = 1;
    pendingRefresh;
    options;
    currentSnapshot = { state: "idle", canRetryRefresh: false };
    constructor(options) {
        this.options = options;
    }
    get snapshot() {
        return this.currentSnapshot;
    }
    isBusy() {
        return ["running", "cancelling", "reconciling"].includes(this.currentSnapshot.state);
    }
    startBlockReason() {
        if (this.active) {
            return "busy";
        }
        return this.pendingRefresh ? "refreshRequired" : undefined;
    }
    clearSettled() {
        if (this.active || this.pendingRefresh) {
            return;
        }
        this.setSnapshot({ state: "idle", canRetryRefresh: false });
    }
    runMutation(spec) {
        const reason = this.startBlockReason();
        if (reason) {
            return Promise.resolve({ kind: "rejected", reason });
        }
        const active = this.begin("mutation", "mutation", spec.label, spec.runningMessage);
        return executeMutation(this.executionRuntime(), active, spec);
    }
    runLoad(spec) {
        const reason = this.startBlockReason();
        if (reason) {
            return Promise.resolve({ kind: "rejected", reason });
        }
        const active = this.begin("load", "load", spec.label, spec.runningMessage);
        return executeLoad(this.executionRuntime(), active, spec);
    }
    retryRefresh() {
        const pending = this.pendingRefresh;
        if (!pending || this.active) {
            return Promise.resolve({ kind: "rejected", reason: "busy" });
        }
        const current = this.options.currentContext();
        if (current.cwd !== pending.origin.cwd || current.generation !== pending.origin.generation) {
            this.pendingRefresh = undefined;
            const token = { id: this.nextOperationId++, ...current };
            this.setSnapshot({ state: "idle", summary: "Discarded a stale refresh retry", canRetryRefresh: false });
            return Promise.resolve({ kind: "stale", token });
        }
        const active = this.begin("retry", "retry", pending.intent.label, "Retrying diff refresh…");
        return executeRefreshRetry(this.executionRuntime(), active, pending);
    }
    cancelActive() {
        const active = this.active;
        if (!active || active.phase === "reconcile") {
            return false;
        }
        active.cancelRequested = true;
        active.controller.abort();
        this.setSnapshot({
            ...this.currentSnapshot,
            state: "cancelling",
            summary: `Cancelling ${this.currentSnapshot.label ?? "operation"}…`,
            canRetryRefresh: this.pendingRefresh !== undefined,
        });
        return true;
    }
    begin(kind, phase, label, summary) {
        const context = this.options.currentContext();
        const token = { id: this.nextOperationId++, cwd: context.cwd, generation: context.generation };
        const controller = new AbortController();
        const parentSignal = this.options.parentSignal;
        const abortFromParent = () => controller.abort(parentSignal?.reason);
        if (parentSignal?.aborted)
            abortFromParent();
        else
            parentSignal?.addEventListener("abort", abortFromParent, { once: true });
        const active = {
            token,
            kind,
            phase,
            controller,
            cancelRequested: false,
            disposeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent),
        };
        this.active = active;
        this.setSnapshot({ state: "running", label, summary, token, canRetryRefresh: this.pendingRefresh !== undefined });
        return active;
    }
    executionContext(active) {
        return { token: active.token, signal: active.controller.signal };
    }
    completionIsStale(active) {
        return this.active !== active || !this.tokenIsCurrent(active.token);
    }
    tokenIsCurrent(token) {
        const current = this.options.currentContext();
        return current.cwd === token.cwd && current.generation === token.generation;
    }
    finish(active, snapshot) {
        if (this.active !== active) {
            return;
        }
        active.disposeParentAbort?.();
        this.active = undefined;
        this.setSnapshot(snapshot);
    }
    finishStale(active, mutation) {
        this.finish(active, { state: "idle", summary: "Ignored a stale operation result", canRetryRefresh: false });
        return { kind: "stale", mutation, token: active.token };
    }
    storeRefreshFailure(active, intent, failure, completion, failedSummary, successMessage) {
        this.pendingRefresh = {
            intent: erasedRefreshIntent(intent),
            failedSummary,
            failure,
            origin: { cwd: active.token.cwd, generation: active.token.generation },
            successMessage,
            completion,
        };
        this.finish(active, {
            state: "refreshFailed",
            label: intent.label,
            summary: failedSummary,
            successMessage,
            failure,
            canRetryRefresh: true,
        });
    }
    executionRuntime() {
        return {
            executionContext: (active) => this.executionContext(active),
            completionIsStale: (active) => this.completionIsStale(active),
            finish: (active, snapshot) => this.finish(active, snapshot),
            finishStale: (active, mutation) => this.finishStale(active, mutation),
            setSnapshot: (snapshot) => this.setSnapshot(snapshot),
            storeRefreshFailure: (active, intent, failure, completion, failedSummary, successMessage) => this.storeRefreshFailure(active, intent, failure, completion, failedSummary, successMessage),
            clearPendingRefresh: () => {
                this.pendingRefresh = undefined;
            },
        };
    }
    setSnapshot(snapshot) {
        this.currentSnapshot = snapshot;
        this.options.onChange?.(snapshot);
    }
}
//# sourceMappingURL=viewer-operation-coordinator.js.map