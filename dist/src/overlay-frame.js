import { fit } from "./render-text.js";
export function createOverlayFrame(baseLineCount, width, theme) {
    const overlayWidth = Math.max(50, Math.min(width - 4, 88));
    const maxItems = Math.max(1, Math.min(13, baseLineCount - 12));
    return {
        maxItems,
        row: (content) => {
            const inner = fit(content, overlayWidth - 2);
            return `${theme.fg("border", "│")}${inner}${theme.fg("border", "│")}`;
        },
        border: (edge) => {
            const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"];
            return theme.fg("border", `${left}${"─".repeat(overlayWidth - 2)}${right}`);
        },
    };
}
export function renderSearchOverlayFrame(frame, theme, title, hint, searchLine, bodyRows) {
    const { row, border } = frame;
    return [
        border("top"),
        row(` ${theme.fg("accent", theme.bold(title))}`),
        row(` ${theme.fg("dim", hint)}`),
        row(searchLine),
        row(""),
        ...bodyRows,
        row(""),
        border("bottom"),
    ];
}
//# sourceMappingURL=overlay-frame.js.map