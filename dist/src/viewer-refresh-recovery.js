export function refreshFailureSnapshot(pending) {
    return {
        state: "refreshFailed",
        label: pending.intent.label,
        summary: pending.failedSummary,
        successMessage: pending.successMessage,
        failure: pending.failure,
        canRetryRefresh: true,
    };
}
export function combinedRefreshFailure(primary, secondary) {
    return {
        summary: secondary.summary,
        details: `${primary.details}\n\nReconciliation/refresh failure:\n${secondary.details}`,
        cause: secondary.cause,
    };
}
export function erasedRefreshIntent(intent) {
    return {
        ...intent,
        apply: (value, token) => intent.apply(value, token),
    };
}
//# sourceMappingURL=viewer-refresh-recovery.js.map