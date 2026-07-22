import { measureWrappedColumns, prepareColumnWrap } from "./ansi-column-wrap.js";
import { slicePreparedColumns } from "./ansi-segments.js";
function whole(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function clamp(value, maximum) {
    return Math.max(0, Math.min(maximum, whole(value)));
}
function scrollbarMarker(index, height, contentHeight, offset, theme) {
    const thumbHeight = Math.min(height, Math.max(1, Math.round((height / contentHeight) * height)));
    const remainingTrack = Math.max(0, height - thumbHeight);
    const maximumOffset = Math.max(1, contentHeight - height);
    const thumbTop = Math.round((offset / maximumOffset) * remainingTrack);
    return theme.fg("dim", index >= thumbTop && index < thumbTop + thumbHeight ? "┃" : "│");
}
const MAX_WRAPPED_WIDTHS = 4;
const wrappedLayouts = new WeakMap();
function wrappedLayout(display, contentWidth) {
    let layouts = wrappedLayouts.get(display);
    if (!layouts) {
        layouts = new Map();
        wrappedLayouts.set(display, layouts);
    }
    const cached = layouts.get(contentWidth);
    if (cached) {
        layouts.delete(contentWidth);
        layouts.set(contentWidth, cached);
        return cached;
    }
    const rows = [];
    let height = 0;
    for (const row of display.rows) {
        const wrap = prepareColumnWrap(row.content, contentWidth);
        rows.push(Object.freeze({ offset: height, wrap }));
        height += wrap.segmentCount;
    }
    const layout = { contentWidth, height, rows: Object.freeze(rows) };
    layouts.set(contentWidth, layout);
    while (layouts.size > MAX_WRAPPED_WIDTHS)
        layouts.delete(layouts.keys().next().value ?? contentWidth);
    return layout;
}
function firstWrappedRow(layout, verticalOffset) {
    let low = 0;
    let high = layout.rows.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((layout.rows[middle]?.offset ?? 0) <= verticalOffset)
            low = middle + 1;
        else
            high = middle;
    }
    return Math.max(0, low - 1);
}
function wrappedVisibleLines(display, layout, verticalOffset, height, gutterWidth) {
    const lines = [];
    const endOffset = verticalOffset + height;
    const firstRow = firstWrappedRow(layout, verticalOffset);
    for (let rowIndex = firstRow; rowIndex < display.rows.length; rowIndex++) {
        const row = display.rows[rowIndex];
        const rowLayout = layout.rows[rowIndex];
        if (!row || !rowLayout)
            continue;
        if (rowLayout.offset >= endOffset)
            break;
        const firstSegment = Math.max(0, verticalOffset - rowLayout.offset);
        const count = Math.min(rowLayout.wrap.segmentCount - firstSegment, endOffset - rowLayout.offset - firstSegment);
        for (const [index, segment] of rowLayout.wrap.segments(firstSegment, count).entries()) {
            const gutterStart = firstSegment + index === 0 ? 0 : row.gutter.width;
            const gutter = slicePreparedColumns(row.gutter, gutterStart, gutterWidth, { pad: true });
            const content = slicePreparedColumns(row.content, segment.start, segment.length, {
                pad: true,
                padTo: layout.contentWidth,
            });
            lines.push(`${gutter}${content}`);
        }
    }
    return lines;
}
function wrappedContentExceeds(display, contentWidth, height) {
    let remaining = height;
    for (const row of display.rows) {
        const measured = measureWrappedColumns(row.content, contentWidth, remaining);
        if (measured.truncated)
            return true;
        remaining -= measured.segmentCount;
    }
    return false;
}
function contentGeometry(display, width, height, wrap) {
    const dimensions = (bodyWidth) => {
        const gutterWidth = Math.min(bodyWidth, display.gutterWidth);
        const contentWidth = Math.max(0, bodyWidth - gutterWidth);
        return { contentWidth, gutterWidth };
    };
    const full = dimensions(width);
    if (!wrap) {
        const scrollable = width > 0 && height > 0 && display.rows.length > height;
        const active = scrollable ? dimensions(Math.max(0, width - 1)) : full;
        return { ...active, contentHeight: display.rows.length, scrollable };
    }
    const scrollable = width > 0 && height > 0 && wrappedContentExceeds(display, full.contentWidth, height);
    const active = scrollable ? dimensions(Math.max(0, width - 1)) : full;
    const layout = wrappedLayout(display, active.contentWidth);
    return { ...active, contentHeight: layout.height, scrollable, wrappedLayout: layout };
}
export function renderDiffViewport(input) {
    const width = whole(input.width);
    const height = whole(input.height);
    const wrap = input.wrap === true;
    const geometry = contentGeometry(input.display, width, height, wrap);
    const maxVerticalOffset = Math.max(0, geometry.contentHeight - height);
    const verticalOffset = clamp(input.verticalOffset, maxVerticalOffset);
    const maxHorizontalOffset = wrap ? 0 : Math.max(0, input.display.maxContentWidth - geometry.contentWidth);
    const horizontalOffset = wrap ? 0 : clamp(input.horizontalOffset, maxHorizontalOffset);
    const visibleRows = wrap
        ? wrappedVisibleLines(input.display, geometry.wrappedLayout ?? wrappedLayout(input.display, geometry.contentWidth), verticalOffset, height, geometry.gutterWidth)
        : input.display.rows.slice(verticalOffset, verticalOffset + height).map((row) => {
            const gutter = slicePreparedColumns(row.gutter, 0, geometry.gutterWidth, { pad: true });
            const content = slicePreparedColumns(row.content, horizontalOffset, geometry.contentWidth, { pad: true });
            return `${gutter}${content}`;
        });
    const lines = visibleRows.map((line, index) => {
        const scrollbar = geometry.scrollable
            ? scrollbarMarker(index, height, geometry.contentHeight, verticalOffset, input.theme)
            : "";
        return `${line}${scrollbar}`;
    });
    while (lines.length < height)
        lines.push(" ".repeat(width));
    return {
        lines,
        verticalOffset,
        horizontalOffset,
        maxVerticalOffset,
        maxHorizontalOffset,
        horizontallyScrollable: maxHorizontalOffset > 0,
        gutterWidth: geometry.gutterWidth,
        contentWidth: geometry.contentWidth,
    };
}
//# sourceMappingURL=diff-viewport.js.map