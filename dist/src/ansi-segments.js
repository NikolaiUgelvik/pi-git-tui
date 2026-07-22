import { visibleWidth } from "@earendil-works/pi-tui";
import { canonicalSgrPrefix as canonicalPrefix, emptySgrState as emptyState, parseTrustedSgrText as parseTrustedText, sgrStateFromAnsi as stateFromAnsi, } from "./ansi-sgr.js";
const RESET = "\x1b[0m";
const TAB_SPACES = "    ";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const preparedInternals = new WeakMap();
function controlEscape(character) {
    return `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
}
export function normalizeDiffText(text) {
    let normalized = "";
    for (const character of text.replace(/\t/gu, TAB_SPACES)) {
        const code = character.charCodeAt(0);
        normalized += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? controlEscape(character) : character;
    }
    return normalized;
}
export function normalizeTabs(text) {
    return text.replace(/\t/gu, TAB_SPACES);
}
export function stripTrustedSgr(text) {
    return parseTrustedText(text)?.plainText;
}
function graphemeData(text) {
    const ascii = /^[\x20-\x7e]*$/u.test(text);
    if (ascii)
        return { ascii: true, width: text.length, starts: Array.from({ length: text.length }, (_, index) => index) };
    const offsets = [];
    const columns = [];
    let column = 0;
    for (const { index, segment } of graphemeSegmenter.segment(text)) {
        offsets.push(index);
        columns.push(column);
        column += visibleWidth(segment);
    }
    offsets.push(text.length);
    columns.push(column);
    return {
        ascii: false,
        width: column,
        offsets: Int32Array.from(offsets),
        columns: Int32Array.from(columns),
        starts: offsets.slice(0, -1),
    };
}
function prepareDecorations(decorations, boundaries) {
    const prepared = [];
    let previousEnd = 0;
    for (const decoration of decorations) {
        const foreground = stateFromAnsi(decoration.foregroundAnsi);
        const background = stateFromAnsi(decoration.backgroundAnsi);
        if (decoration.start < previousEnd ||
            decoration.end <= decoration.start ||
            !boundaries.has(decoration.start) ||
            !boundaries.has(decoration.end) ||
            (foreground === undefined && decoration.foregroundAnsi !== undefined) ||
            (background === undefined && decoration.backgroundAnsi !== undefined)) {
            return;
        }
        prepared.push({ ...decoration, foreground: foreground?.foreground, background: background?.background });
        previousEnd = decoration.end;
    }
    return prepared;
}
function composedState(syntax, options, base, background, decoration) {
    const state = { ...syntax };
    if (options.baseForegroundAnsi !== undefined && state.foreground === undefined)
        state.foreground = base?.foreground;
    if (options.backgroundAnsi !== undefined)
        state.background = background?.background;
    if (decoration) {
        if (decoration.foregroundAnsi !== undefined)
            state.foreground = decoration.foreground;
        if (decoration.backgroundAnsi !== undefined)
            state.background = decoration.background;
        if (decoration.bold !== undefined)
            state.bold = decoration.bold;
    }
    return state;
}
function paddingPrefix(options) {
    const foreground = stateFromAnsi(options.paddingForegroundAnsi);
    const background = stateFromAnsi(options.paddingBackgroundAnsi);
    if (options.paddingForegroundAnsi !== undefined && !foreground)
        return;
    if (options.paddingBackgroundAnsi !== undefined && !background)
        return;
    const state = emptyState();
    state.foreground = foreground?.foreground;
    state.background = background?.background;
    return canonicalPrefix(state);
}
function appendStyleRun(runs, run) {
    const previous = runs.at(-1);
    if (previous?.prefix === run.prefix && previous.end === run.start) {
        runs[runs.length - 1] = { ...previous, end: run.end };
    }
    else
        runs.push(run);
}
function buildStyleRuns(parsed, graphemes, decorations, options) {
    const runs = [];
    const base = stateFromAnsi(options.baseForegroundAnsi);
    const background = stateFromAnsi(options.backgroundAnsi);
    let syntaxIndex = 0;
    let decorationIndex = 0;
    for (const [graphemeIndex, start] of graphemes.starts.entries()) {
        while ((parsed.runs[syntaxIndex]?.end ?? Number.POSITIVE_INFINITY) <= start)
            syntaxIndex++;
        while ((decorations[decorationIndex]?.end ?? Number.POSITIVE_INFINITY) <= start)
            decorationIndex++;
        const syntax = parsed.runs[syntaxIndex]?.state ?? emptyState();
        const decoration = decorations[decorationIndex];
        const activeDecoration = decoration && decoration.start <= start && start < decoration.end ? decoration : undefined;
        const prefix = canonicalPrefix(composedState(syntax, options, base, background, activeDecoration));
        appendStyleRun(runs, {
            start,
            end: graphemes.starts[graphemeIndex + 1] ?? parsed.plainText.length,
            prefix,
        });
    }
    return runs;
}
function preparedWeight(parsed, graphemes, runs, padding) {
    const boundaryBytes = (graphemes.offsets?.byteLength ?? 0) + (graphemes.columns?.byteLength ?? 0);
    return (96 +
        Buffer.byteLength(parsed.plainText, "utf8") +
        boundaryBytes +
        Buffer.byteLength(padding, "utf8") +
        runs.reduce((total, run) => total + 40 + Buffer.byteLength(run.prefix, "utf8"), 0));
}
export function prepareStyledColumns(trustedStyledText, options = {}) {
    const parsed = parseTrustedText(trustedStyledText);
    if (!parsed)
        return;
    if (options.expectedPlainText !== undefined && parsed.plainText !== options.expectedPlainText)
        return;
    const graphemes = graphemeData(parsed.plainText);
    const decorations = prepareDecorations(options.decorations ?? [], new Set([...graphemes.starts, parsed.plainText.length]));
    if (!decorations)
        return;
    const padding = paddingPrefix(options);
    if (padding === undefined)
        return;
    const runs = buildStyleRuns(parsed, graphemes, decorations, options);
    const prepared = Object.freeze({
        plainText: parsed.plainText,
        width: graphemes.width,
        weightBytes: preparedWeight(parsed, graphemes, runs, padding),
    });
    preparedInternals.set(prepared, {
        runs: Object.freeze(runs),
        ascii: graphemes.ascii,
        graphemeOffsets: graphemes.offsets,
        graphemeColumns: graphemes.columns,
        paddingPrefix: padding,
    });
    return prepared;
}
function boundedWhole(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function styleAt(runs, offset) {
    return runs.find((run) => run.start <= offset && offset < run.end)?.prefix ?? "";
}
function appendStyled(result, active, prefix, text) {
    if (text.length === 0)
        return { result, active };
    if (active !== prefix) {
        if (active)
            result += RESET;
        if (prefix)
            result += prefix;
    }
    return { result: result + text, active: prefix };
}
function firstGraphemeAtOrAfter(columns, column) {
    let low = 0;
    let high = Math.max(0, columns.length - 1);
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((columns[middle + 1] ?? 0) <= column)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
}
function sliceAscii(line, internals, start, end) {
    const output = { result: "", active: "", columns: 0 };
    const textStart = Math.min(line.plainText.length, start);
    const textEnd = Math.min(line.plainText.length, end);
    for (const run of internals.runs) {
        const from = Math.max(textStart, run.start);
        const to = Math.min(textEnd, run.end);
        if (to <= from)
            continue;
        Object.assign(output, appendStyled(output.result, output.active, run.prefix, line.plainText.slice(from, to)));
        output.columns += to - from;
    }
    return output;
}
function slicedGrapheme(line, internals, index, start, end) {
    const offsets = internals.graphemeOffsets ?? new Int32Array();
    const columns = internals.graphemeColumns ?? new Int32Array();
    const graphemeStart = columns[index] ?? 0;
    const graphemeEnd = columns[index + 1] ?? graphemeStart;
    const overlap = Math.max(0, Math.min(end, graphemeEnd) - Math.max(start, graphemeStart));
    if (overlap === 0)
        return;
    const offset = offsets[index] ?? 0;
    const fullyVisible = graphemeStart >= start && graphemeEnd <= end;
    return {
        offset,
        overlap,
        text: fullyVisible ? line.plainText.slice(offset, offsets[index + 1]) : " ".repeat(overlap),
    };
}
function sliceUnicode(line, internals, start, end) {
    const output = { result: "", active: "", columns: 0 };
    const offsets = internals.graphemeOffsets ?? new Int32Array();
    const columns = internals.graphemeColumns ?? new Int32Array();
    for (let index = firstGraphemeAtOrAfter(columns, start); index < offsets.length - 1; index++) {
        if ((columns[index] ?? 0) >= end)
            break;
        const grapheme = slicedGrapheme(line, internals, index, start, end);
        if (!grapheme)
            continue;
        const prefix = styleAt(internals.runs, grapheme.offset);
        Object.assign(output, appendStyled(output.result, output.active, prefix, grapheme.text));
        output.columns += grapheme.overlap;
    }
    return output;
}
function finishSlice(output, outputLength, paddingPrefixValue, pad) {
    let result = output.active ? `${output.result}${RESET}` : output.result;
    if (!pad || output.columns >= outputLength)
        return result;
    const padding = " ".repeat(outputLength - output.columns);
    result += paddingPrefixValue ? `${paddingPrefixValue}${padding}${RESET}` : padding;
    return result;
}
export function slicePreparedColumns(line, startColumn, length, options = {}) {
    const start = boundedWhole(startColumn);
    const requestedLength = boundedWhole(length);
    const outputLength = options.pad
        ? Math.max(requestedLength, boundedWhole(options.padTo ?? requestedLength))
        : requestedLength;
    if (requestedLength === 0 && outputLength === 0)
        return "";
    const internals = preparedInternals.get(line);
    if (!internals)
        return options.pad ? " ".repeat(outputLength) : "";
    const output = internals.ascii
        ? sliceAscii(line, internals, start, start + requestedLength)
        : sliceUnicode(line, internals, start, start + requestedLength);
    return finishSlice(output, outputLength, internals.paddingPrefix, options.pad);
}
export function sliceStyledColumns(line, startColumn, length, options = {}) {
    const prepared = prepareStyledColumns(line);
    return prepared ? slicePreparedColumns(prepared, startColumn, length, options) : options.pad ? " ".repeat(length) : "";
}
//# sourceMappingURL=ansi-segments.js.map