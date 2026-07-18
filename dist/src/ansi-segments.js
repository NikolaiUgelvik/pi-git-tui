import { visibleWidth } from "@earendil-works/pi-tui";
const ESCAPE = "\x1b";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
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
    return [...graphemeSegmenter.segment(text)].map(({ segment }) => ({
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
        const params = code.slice(2, -1);
        this.activeCodes = params === "" || params === "0" ? [] : [...this.activeCodes, code];
    }
    activePrefix() {
        return this.activeCodes.join("");
    }
}
function appendTextInRange(result, token, currentColumn, range, prefix) {
    if (currentColumn < range.start || currentColumn >= range.end) {
        return { result, started: false };
    }
    const started = result.length > 0;
    return { result: `${result}${started ? "" : prefix}${token.text}`, started: true };
}
export function sliceStyledColumns(line, startColumn, length) {
    const range = { start: startColumn, end: startColumn + length };
    const tracker = new SgrTracker();
    let result = "";
    let currentColumn = 0;
    for (const token of styledTokens(line)) {
        if (token.kind === "sgr") {
            tracker.process(token.code);
            continue;
        }
        const appended = appendTextInRange(result, token, currentColumn, range, tracker.activePrefix());
        result = appended.result;
        currentColumn += token.width;
        if (currentColumn >= range.end) {
            break;
        }
    }
    return result;
}
//# sourceMappingURL=ansi-segments.js.map