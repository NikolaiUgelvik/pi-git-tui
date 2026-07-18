function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function explicitDetails(error) {
    if (typeof error !== "object" || error === null || !("details" in error)) {
        return;
    }
    return typeof error.details === "string" && error.details.trim() ? error.details : undefined;
}
export function failureDetails(error, fallbackSummary) {
    const message = errorMessage(error).trim();
    const summary = message.split("\n").find(Boolean) ?? fallbackSummary;
    const details = explicitDetails(error) ?? (error instanceof Error ? error.stack : undefined) ?? message ?? fallbackSummary;
    return { summary, details, cause: error };
}
//# sourceMappingURL=failure-details.js.map