const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemes(text, maximum) {
    const result = [];
    for (const { index, segment } of graphemeSegmenter.segment(text)) {
        if (result.length >= maximum)
            return;
        result.push({ text: segment, start: index, end: index + segment.length });
    }
    return result;
}
function changedRange(parts, prefix, suffix, textLength) {
    const first = parts[prefix];
    const last = parts[parts.length - suffix - 1];
    const start = first?.start ?? textLength;
    const end = last?.end ?? start;
    return end > start ? { start, end } : undefined;
}
export function relativeIntralineChanges(oldText, newText, maximumGraphemes) {
    const oldParts = graphemes(oldText, maximumGraphemes);
    const newParts = graphemes(newText, maximumGraphemes);
    if (!oldParts || !newParts)
        return;
    const sharedLength = Math.min(oldParts.length, newParts.length);
    let prefix = 0;
    while (prefix < sharedLength && oldParts[prefix]?.text === newParts[prefix]?.text)
        prefix++;
    let suffix = 0;
    while (suffix < sharedLength - prefix &&
        oldParts[oldParts.length - suffix - 1]?.text === newParts[newParts.length - suffix - 1]?.text) {
        suffix++;
    }
    return {
        oldRange: changedRange(oldParts, prefix, suffix, oldText.length),
        newRange: changedRange(newParts, prefix, suffix, newText.length),
        graphemeCount: oldParts.length + newParts.length,
    };
}
//# sourceMappingURL=diff-intraline-algorithm.js.map