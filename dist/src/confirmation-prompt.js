import { matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
const LEGACY_CANCEL_KEYS = new Set(["q", "Q"]);
const RAW_ENTER_KEYS = new Set(["\r", "\n"]);
export function confirmationDecision(data, allowLegacyQ = true) {
    if (matchesKey(data, "escape")) {
        return "cancel";
    }
    if (allowLegacyQ && LEGACY_CANCEL_KEYS.has(data)) {
        return "cancel";
    }
    if (RAW_ENTER_KEYS.has(data) || matchesKey(data, "enter") || matchesKey(data, "return")) {
        return "confirm";
    }
}
export function confirmationHint(prompt) {
    return `Enter: ${prompt.confirmLabel} • Esc: Cancel • F1: Help`;
}
export function initializationConfirmationPrompt(path) {
    return {
        title: "Initialize Git repository",
        details: [`Location: ${path}`, "Creates Git metadata without changing existing files."],
        confirmLabel: "Initialize",
    };
}
export function discardConfirmationPrompt(file) {
    if (!file) {
        return trackedDiscardPrompt("selected file");
    }
    if (file.untracked) {
        return {
            title: "Discard untracked file",
            details: [`Path: ${file.path}`],
            consequence: "Permanently removes this untracked file. This cannot be undone.",
            confirmLabel: "Discard",
        };
    }
    if (file.status === "renamed") {
        const oldPath = file.oldPath ?? file.path;
        const newPath = file.newPath ?? file.path;
        return {
            title: "Discard renamed file changes",
            details: [`Rename: ${oldPath} → ${newPath}`, `Affected paths: ${oldPath}, ${newPath}`],
            consequence: "Removes staged and unstaged changes for both rename paths. This cannot be undone.",
            confirmLabel: "Discard",
        };
    }
    return trackedDiscardPrompt(file.path);
}
function trackedDiscardPrompt(path) {
    return {
        title: "Discard tracked file changes",
        details: [`Path: ${path}`],
        consequence: "Removes all staged and unstaged changes for this tracked file. This cannot be undone.",
        confirmLabel: "Discard",
    };
}
function confirmationRows(text, width) {
    if (width === undefined) {
        return [text];
    }
    return wrapTextWithAnsi(text, Math.max(1, width));
}
export function confirmationBodyLines(prompt, theme, options = {}) {
    const details = prompt.details.flatMap((detail) => confirmationRows(` ${detail}`, options.width));
    const consequence = prompt.consequence
        ? confirmationRows(theme.fg("warning", ` ${prompt.consequence}`), options.width)
        : [];
    const separator = consequence.length > 0 && !options.compact ? [""] : [];
    const rows = [...details, ...separator, ...consequence];
    const maxRows = options.maxRows;
    if (maxRows === undefined || rows.length <= maxRows) {
        return rows;
    }
    if (maxRows <= 0) {
        return [];
    }
    if (consequence.length === 0) {
        return rows.slice(0, maxRows);
    }
    const consequenceRows = Math.min(consequence.length, maxRows === 1 ? 1 : Math.min(2, maxRows - 1));
    return [...details.slice(0, maxRows - consequenceRows), ...consequence.slice(0, consequenceRows)];
}
//# sourceMappingURL=confirmation-prompt.js.map