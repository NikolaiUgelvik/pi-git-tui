import { matchesKey } from "@earendil-works/pi-tui";
export function isViewerKey(data, key) {
    return data === key || data === key.toUpperCase();
}
export function isHelpKey(data) {
    return data === "?";
}
export function isHelpCloseInput(data) {
    return isHelpKey(data) || matchesKey(data, "escape") || isViewerKey(data, "q");
}
export function isEnterInput(data) {
    return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n";
}
export function isShiftEnterInput(data) {
    return matchesKey(data, "shift+enter") || data === "\x1b[13;2u";
}
export function isPageUpInput(data) {
    return matchesKey(data, "pageUp") || data === "\x1b[5~";
}
export function isPageDownInput(data) {
    return matchesKey(data, "pageDown") || data === "\x1b[6~";
}
export function arrowScrollDelta(data) {
    if (matchesKey(data, "up") || isViewerKey(data, "k")) {
        return -1;
    }
    return matchesKey(data, "down") || isViewerKey(data, "j") ? 1 : 0;
}
export function isPrintableInput(data) {
    if (data.length === 0 || data.includes("\x1b")) {
        return false;
    }
    return [...data].every((char) => {
        const codePoint = char.codePointAt(0);
        return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
}
//# sourceMappingURL=viewer-key-input.js.map