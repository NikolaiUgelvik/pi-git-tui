import { failureDetails } from "./failure-details.js";
import { combinedRefreshFailure, refreshFailureSnapshot } from "./viewer-refresh-recovery.js";
export async function reconcileCancellation(runtime, active, intent, mutation, successMessage) {
    active.phase = "reconcile";
    active.controller = new AbortController();
    runtime.setSnapshot({
        state: "reconciling",
        label: intent.label,
        summary: "Cancellation outcome is uncertain; reconciling repository state…",
        successMessage,
        token: active.token,
        canRetryRefresh: false,
    });
    try {
        const refreshed = await intent.run(runtime.executionContext(active));
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active, mutation);
        }
        intent.apply(refreshed, active.token);
        const summary = successMessage
            ? `${successMessage}; repository reconciled after cancellation`
            : "Repository reconciled after cancellation";
        runtime.finish(active, {
            state: "succeeded",
            label: intent.label,
            summary,
            successMessage: successMessage ?? summary,
            canRetryRefresh: false,
        });
        return { kind: "cancelled", mutation, reconciled: true, token: active.token };
    }
    catch (error) {
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active, mutation);
        }
        const failure = failureDetails(error, "Reconciliation refresh failed");
        runtime.storeRefreshFailure(active, intent, failure, {
            state: "succeeded",
            label: intent.label,
            summary: successMessage ?? "Repository reconciled after cancellation",
            successMessage: successMessage ?? "Repository reconciled after cancellation",
            canRetryRefresh: false,
        }, "Cancellation outcome is uncertain; diff refresh failed.", successMessage);
        return { kind: "cancelled", mutation, reconciled: false, token: active.token };
    }
}
export async function reconcileMutationFailure(runtime, active, intent, mutationFailure) {
    active.phase = "reconcile";
    active.controller = new AbortController();
    runtime.setSnapshot({
        state: "reconciling",
        label: intent.label,
        summary: "Action failed; reconciling repository state…",
        failure: mutationFailure,
        token: active.token,
        canRetryRefresh: false,
    });
    try {
        const refreshed = await intent.run(runtime.executionContext(active));
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active);
        }
        intent.apply(refreshed, active.token);
        runtime.finish(active, {
            state: "failed",
            label: intent.label,
            summary: mutationFailure.summary,
            failure: mutationFailure,
            canRetryRefresh: false,
        });
        return { kind: "mutationFailed", failure: mutationFailure, reconciled: true, token: active.token };
    }
    catch (error) {
        if (runtime.completionIsStale(active)) {
            return runtime.finishStale(active);
        }
        const refreshFailure = failureDetails(error, "Reconciliation refresh failed");
        const failure = combinedRefreshFailure(mutationFailure, refreshFailure);
        runtime.storeRefreshFailure(active, intent, failure, {
            state: "failed",
            label: intent.label,
            summary: mutationFailure.summary,
            failure: mutationFailure,
            canRetryRefresh: false,
        }, "Action failed; diff reconciliation failed.");
        return { kind: "refreshFailed", failure, token: active.token };
    }
}
export async function executeRefreshRetry(runtime, active, pending) {
    try {
        const refreshed = await pending.intent.run(runtime.executionContext(active));
        if (runtime.completionIsStale(active)) {
            runtime.clearPendingRefresh();
            runtime.finish(active, { state: "idle", summary: "Ignored a stale refresh result", canRetryRefresh: false });
            return { kind: "stale", token: active.token };
        }
        if (active.cancelRequested) {
            runtime.finish(active, refreshFailureSnapshot(pending));
            return { kind: "cancelled", token: active.token };
        }
        pending.intent.apply(refreshed, active.token);
        runtime.clearPendingRefresh();
        runtime.finish(active, { ...pending.completion, canRetryRefresh: false });
        return { kind: "succeeded", value: refreshed, token: active.token };
    }
    catch (error) {
        if (runtime.completionIsStale(active)) {
            runtime.clearPendingRefresh();
            runtime.finish(active, { state: "idle", summary: "Ignored a stale refresh failure", canRetryRefresh: false });
            return { kind: "stale", token: active.token };
        }
        if (active.cancelRequested) {
            runtime.finish(active, refreshFailureSnapshot(pending));
            return { kind: "cancelled", token: active.token };
        }
        const retryFailure = failureDetails(error, "Diff refresh failed");
        pending.failure = combinedRefreshFailure(pending.failure, retryFailure);
        runtime.finish(active, refreshFailureSnapshot(pending));
        return { kind: "failed", failure: pending.failure, token: active.token };
    }
}
//# sourceMappingURL=viewer-reconciliation-execution.js.map