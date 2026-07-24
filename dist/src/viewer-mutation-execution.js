import { failureDetails } from "./failure-details.js";
import { reconcileCancellation, reconcileMutationFailure } from "./viewer-reconciliation-execution.js";
export async function executeMutation(runtime, active, spec) {
    let mutation;
    try {
        mutation = await spec.mutate(runtime.executionContext(active));
    }
    catch (error) {
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active);
        }
        if (active.cancelRequested) {
            return reconcileCancellation(runtime, active, spec.refresh);
        }
        const failure = failureDetails(error, `${spec.label} failed`);
        if (spec.reconcileOnFailure) {
            return reconcileMutationFailure(runtime, active, spec.refresh, failure);
        }
        runtime.finish(active, {
            state: "failed",
            label: spec.label,
            summary: failure.summary,
            failure,
            canRetryRefresh: false,
        });
        return { kind: "mutationFailed", failure, reconciled: false, token: active.token };
    }
    const successMessage = spec.successMessage(mutation);
    if (runtime.completionIsStale(active)) {
        return runtime.finishStale(active, mutation);
    }
    if (active.cancelRequested) {
        return reconcileCancellation(runtime, active, spec.refresh, mutation, successMessage);
    }
    if (spec.refreshAfterSuccess === false) {
        runtime.finish(active, {
            state: "succeeded",
            label: spec.label,
            summary: successMessage,
            successMessage,
            canRetryRefresh: false,
        });
        return { kind: "succeeded", mutation, token: active.token };
    }
    active.phase = "refresh";
    runtime.setSnapshot({
        state: "running",
        label: spec.label,
        summary: `${successMessage}; refreshing diff…`,
        successMessage,
        token: active.token,
        canRetryRefresh: false,
    });
    try {
        const refreshed = await spec.refresh.run(runtime.executionContext(active));
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active, mutation);
        }
        if (active.cancelRequested) {
            return reconcileCancellation(runtime, active, spec.refresh, mutation, successMessage);
        }
        spec.refresh.apply(refreshed, active.token);
        runtime.finish(active, {
            state: "succeeded",
            label: spec.label,
            summary: successMessage,
            successMessage,
            canRetryRefresh: false,
        });
        return { kind: "succeeded", mutation, token: active.token };
    }
    catch (error) {
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active, mutation);
        }
        if (active.cancelRequested) {
            return reconcileCancellation(runtime, active, spec.refresh, mutation, successMessage);
        }
        const failure = failureDetails(error, "Diff refresh failed");
        runtime.storeRefreshFailure(active, spec.refresh, failure, {
            state: "succeeded",
            label: spec.label,
            summary: successMessage,
            successMessage,
            canRetryRefresh: false,
        }, `Action succeeded; ${spec.refresh.label} failed.`, successMessage);
        return { kind: "refreshFailed", mutation, failure, token: active.token };
    }
}
//# sourceMappingURL=viewer-mutation-execution.js.map