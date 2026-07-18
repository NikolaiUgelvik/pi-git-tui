import { visibleWidth } from "@earendil-works/pi-tui";
const ESCAPE = "\x1b";
const RESET = "\x1b[0m";
const TAB_SPACES = "    ";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function normalizeTabs(text) {
    return text.replace(/\t/gu, TAB_SPACES);
}
function readSgrCode(line, index) {
    if (line[index] !== ESCAPE || line[index + 1] !== "[") {
        return undefined;
    }
    const end = line.indexOf("m", index + 2);
    return end === -1 ? undefined : { code: line.slice(index, end + 1), length: end + 1 - index };
}
function nextSgrStart(line, index) {
    const start = line.indexOf(ESCAPE, index);
    return start === -1 ? line.length : start;
}
function textTokens(text) {
    return [...graphemeSegmenter.segment(normalizeTabs(text))].map(({ segment }) => ({
        kind: "text",
        text: segment,
        width: visibleWidth(segment),
    }));
}
function styledTokens(line) {
    const tokens = [];
    let index = 0;
    while (index < line.length) {
        const sgr = readSgrCode(line, index);
        if (sgr) {
            tokens.push({ kind: "sgr", code: sgr.code });
            index += sgr.length;
            continue;
        }
        const textEnd = nextSgrStart(line, index + 1);
        tokens.push(...textTokens(line.slice(index, textEnd)));
        index = textEnd;
    }
    return tokens;
}
class SgrTracker {
    activeCodes = [];
    process(code) {
        const parameters = code.slice(2, -1);
        const values = parameters === "" ? [0] : parameters.split(";").map((value) => Number(value));
        if (values.includes(0)) {
            this.activeCodes = values.some((value) => value !== 0) ? [code] : [];
            return;
        }
        this.activeCodes.push(code);
    }
    activePrefix() {
        return this.activeCodes.join("");
    }
}
function boundedWhole(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
export function sliceStyledColumns(line, startColumn, length, options = {}) {
    const start = boundedWhole(startColumn);
    const requestedLength = boundedWhole(length);
    if (requestedLength === 0) {
        return "";
    }
    const end = start + requestedLength;
    const tracker = new SgrTracker();
    let result = "";
    let currentColumn = 0;
    let outputColumns = 0;
    let outputStarted = false;
    let emittedStyle = false;
    const startOutput = () => {
        if (outputStarted) {
            return;
        }
        const prefix = tracker.activePrefix();
        result += prefix;
        emittedStyle ||= prefix.length > 0;
        outputStarted = true;
    };
    for (const token of styledTokens(line)) {
        if (token.kind === "sgr") {
            tracker.process(token.code);
            if (outputStarted && currentColumn >= start && currentColumn < end) {
                result += token.code;
                emittedStyle = true;
            }
            continue;
        }
        if (token.width === 0) {
            if (outputStarted && currentColumn >= start && currentColumn <= end) {
                result += token.text;
            }
            continue;
        }
        const tokenStart = currentColumn;
        const tokenEnd = currentColumn + token.width;
        currentColumn = tokenEnd;
        const overlapStart = Math.max(start, tokenStart);
        const overlapEnd = Math.min(end, tokenEnd);
        const overlapWidth = Math.max(0, overlapEnd - overlapStart);
        if (overlapWidth === 0) {
            if (tokenStart >= end) {
                break;
            }
            continue;
        }
        startOutput();
        const fullyVisible = tokenStart >= start && tokenEnd <= end;
        result += fullyVisible ? token.text : " ".repeat(overlapWidth);
        outputColumns += fullyVisible ? token.width : overlapWidth;
        if (currentColumn >= end) {
            break;
        }
    }
    if (emittedStyle && !result.endsWith(RESET)) {
        result += RESET;
    }
    if (options.pad && outputColumns < requestedLength) {
        result += " ".repeat(requestedLength - outputColumns);
    }
    return result;
}
//# sourceMappingURL=ansi-segments.js.map