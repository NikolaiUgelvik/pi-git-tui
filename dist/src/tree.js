function addDirectoryRows(rows, seenDirs, dirs) {
    let dirPath = "";
    for (const [depth, dir] of dirs.entries()) {
        dirPath = dirPath ? `${dirPath}/${dir}` : dir;
        if (!seenDirs.has(dirPath)) {
            seenDirs.add(dirPath);
            rows.push({ label: dir, depth, isLast: false });
        }
    }
}
function stagedGlyph(file) {
    return file.staged ? "●" : " ";
}
const STATUS_GLYPHS = {
    added: "A",
    binary: "B",
    conflicted: "U",
    copied: "C",
    deleted: "D",
    modified: "M",
    renamed: "R",
};
function statusGlyph(status) {
    return STATUS_GLYPHS[status];
}
function addFileRow(rows, seenDirs, info) {
    const displayParts = info.file.path.split("/").filter(Boolean);
    addDirectoryRows(rows, seenDirs, displayParts.slice(0, -1));
    const omission = info.file.omission ? " (omitted)" : "";
    rows.push({
        label: `${stagedGlyph(info.file)} ${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}${omission}`,
        fileIndex: info.index,
        depth: Math.max(0, displayParts.length - 1),
        isLast: true,
    });
}
export function buildTreeRows(files) {
    const rows = [];
    const seenDirs = new Set();
    const indexed = files.map((file, index) => ({ file, index }));
    indexed.sort((left, right) => left.file.path.localeCompare(right.file.path) || left.index - right.index);
    for (const info of indexed)
        addFileRow(rows, seenDirs, info);
    return rows;
}
//# sourceMappingURL=tree.js.map