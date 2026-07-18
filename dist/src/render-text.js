import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { normalizeTabs } from "./ansi-segments.js";
function padToWidth(text, width) {
    const padding = Math.max(0, width - visibleWidth(text));
    return text + " ".repeat(padding);
}
export function fit(text, width) {
    if (width <= 0) {
        return "";
    }
    // Raw git diffs can contain tabs. Terminals expand tabs to multiple cells,
    // while string-width helpers can undercount them, so normalize before sizing.
    const normalized = normalizeTabs(text);
    return padToWidth(truncateToWidth(normalized, width, "…"), width);
}
//# sourceMappingURL=render-text.js.map