import { fit } from "./render-text.js";
import { measureOverlayGeometry } from "./responsive-geometry.js";
function overlayRow(content, width, theme) {
    if (width <= 0) {
        return "";
    }
    if (width === 1) {
        return theme.fg("border", "│");
    }
    const inner = fit(content, width - 2);
    return `${theme.fg("border", "│")}${inner}${theme.fg("border", "│")}`;
}
function overlayBorder(edge, width, theme) {
    if (width <= 0) {
        return "";
    }
    const [left, right] = edge === "top" ? ["╭", "╮"] : ["╰", "╯"];
    if (width === 1) {
        return theme.fg("border", left);
    }
    return theme.fg("border", `${left}${"─".repeat(Math.max(0, width - 2))}${right}`);
}
export function createOverlayFrame(baseLineCount, width, theme) {
    const geometry = measureOverlayGeometry({ width, height: baseLineCount });
    const compact = geometry.density === "compact";
    const searchChromeRows = compact ? 1 : 3;
    const maxItems = Math.max(0, Math.min(13, geometry.bodyRows - searchChromeRows));
    return {
        geometry,
        innerWidth: geometry.innerWidth,
        bodyRows: geometry.bodyRows,
        maxItems,
        compact,
        row: (content) => overlayRow(content, geometry.width, theme),
        border: (edge) => overlayBorder(edge, geometry.width, theme),
    };
}
function fittedBody(frame, body) {
    const visible = body.slice(0, frame.bodyRows);
    while (visible.length < frame.bodyRows) {
        visible.push("");
    }
    return visible.map(frame.row);
}
export function renderOverlayFrame(frame, title, hint, body) {
    const { height } = frame.geometry;
    if (height <= 0) {
        return [];
    }
    if (height === 1) {
        return [frame.border("top")];
    }
    if (height === 2) {
        return [frame.border("top"), frame.border("bottom")];
    }
    if (height === 3) {
        return [frame.border("top"), frame.row(title), frame.border("bottom")];
    }
    return [frame.border("top"), frame.row(title), frame.row(hint), ...fittedBody(frame, body), frame.border("bottom")];
}
export function renderSearchOverlayFrame(frame, theme, title, hint, searchLine, bodyRows) {
    const body = frame.compact ? [searchLine, ...bodyRows] : [searchLine, "", ...bodyRows, ""];
    return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold(title))}`, ` ${theme.fg("dim", hint)}`, body);
}
//# sourceMappingURL=overlay-frame.js.map