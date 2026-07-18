const PATCH_START = /^diff --(?:git|cc|combined) /gmu;
export function utf8Bytes(value) {
    return Buffer.byteLength(value, "utf8");
}
export function textLineCount(value) {
    if (!value) {
        return 0;
    }
    let lines = value.endsWith("\n") ? 0 : 1;
    for (const character of value) {
        if (character === "\n") {
            lines++;
        }
    }
    return lines;
}
export function splitGitPatch(raw) {
    const starts = [...raw.matchAll(PATCH_START)].map((match) => match.index);
    const first = starts[0];
    if (first === undefined) {
        return { preamble: raw, chunks: [] };
    }
    const chunks = starts.map((start, index) => raw.slice(start, starts[index + 1] ?? raw.length));
    return { preamble: raw.slice(0, first), chunks };
}
//# sourceMappingURL=git-patch.js.map