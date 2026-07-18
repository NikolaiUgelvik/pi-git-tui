export const SPLIT_LAYOUT_MIN_WIDTH = 72;
const MAX_OVERLAY_WIDTH = 88;
function whole(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function splitWidths(innerWidth) {
    const available = Math.max(0, innerWidth - 1);
    if (available < 2) {
        return { treeWidth: available, diffWidth: 0 };
    }
    const preferredTreeWidth = clamp(Math.floor(innerWidth * 0.34), 24, 42);
    const treeWidth = clamp(preferredTreeWidth, 1, available - 1);
    return { treeWidth, diffWidth: available - treeWidth };
}
export function measureViewerGeometry(input) {
    const width = whole(input.width);
    const height = Math.max(0, whole(input.terminalRows) - 2);
    const innerWidth = Math.max(0, width - 2);
    const density = width < 12 || height < 6 ? "too-small" : height < 9 ? "compact" : "normal";
    const layout = density === "too-small" ? "too-small" : input.empty ? "empty" : width >= SPLIT_LAYOUT_MIN_WIDTH ? "split" : "single";
    const panelRows = density === "normal" ? Math.max(0, height - 7) : Math.max(0, height - 4);
    const bodyRows = Math.max(0, panelRows - 1);
    const split = layout === "split" ? splitWidths(innerWidth) : { treeWidth: 0, diffWidth: 0 };
    const treeWidth = layout === "single" && input.focusedPanel === "tree" ? innerWidth : split.treeWidth;
    const diffWidth = layout === "single" && input.focusedPanel === "diff" ? innerWidth : split.diffWidth;
    return {
        width,
        height,
        innerWidth,
        density,
        layout,
        panelRows,
        bodyRows,
        separatorWidth: layout === "split" ? 1 : 0,
        treeWidth,
        diffWidth,
        mainWidth: innerWidth,
    };
}
export function measureOverlayGeometry(input, options = {}) {
    const availableWidth = whole(input.width);
    const availableHeight = whole(input.height);
    const horizontalMargin = availableWidth >= 6 ? 2 : 0;
    const maximumWidth = Math.max(0, availableWidth - horizontalMargin * 2);
    const preferredWidth = Math.max(2, whole(options.preferredWidth ?? MAX_OVERLAY_WIDTH));
    const width = Math.min(maximumWidth, preferredWidth);
    const density = availableWidth < 54 || availableHeight < 12 ? "compact" : "normal";
    const preferredBodyRows = whole(options.preferredBodyRows ?? 16);
    const preferredHeight = preferredBodyRows + 4;
    const height = Math.min(availableHeight, preferredHeight);
    const left = Math.max(0, Math.floor((availableWidth - width) / 2));
    const top = Math.max(0, Math.floor((availableHeight - height) / 2));
    return {
        left,
        top,
        width,
        height,
        innerWidth: Math.max(0, width - 2),
        bodyRows: Math.max(0, height - 4),
        density,
    };
}
//# sourceMappingURL=responsive-geometry.js.map