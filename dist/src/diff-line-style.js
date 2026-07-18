function conflictMarkerText(line) {
    return /^[+\- ]/.test(line) ? line.slice(1) : line;
}
function isConflictBoundaryLine(line) {
    const text = conflictMarkerText(line);
    return text.startsWith("<<<<<<<") || text.startsWith(">>>>>>>");
}
function isConflictSeparatorLine(line) {
    const text = conflictMarkerText(line);
    return text.startsWith("|||||||") || text.startsWith("=======");
}
function isAddedDiffLine(line) {
    return line.startsWith("+") && !line.startsWith("+++");
}
function isRemovedDiffLine(line) {
    return line.startsWith("-") && !line.startsWith("---");
}
function isDiffTitleLine(line) {
    return line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---");
}
function isDiffMetadataLine(line) {
    return ["index ", "new file", "deleted file", "similarity ", "rename "].some((prefix) => line.startsWith(prefix));
}
const DIFF_LINE_STYLE_RULES = [
    { matches: isConflictBoundaryLine, color: "error", bold: true },
    { matches: isConflictSeparatorLine, color: "warning", bold: true },
    { matches: isAddedDiffLine, color: "toolDiffAdded" },
    { matches: isRemovedDiffLine, color: "toolDiffRemoved" },
    { matches: (line) => line.startsWith("@@"), color: "accent" },
    { matches: isDiffTitleLine, color: "toolTitle", bold: true },
    { matches: isDiffMetadataLine, color: "muted" },
];
export function diffLineStyleForText(line) {
    return DIFF_LINE_STYLE_RULES.find(({ matches }) => matches(line));
}
//# sourceMappingURL=diff-line-style.js.map