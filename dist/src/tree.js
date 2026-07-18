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
const STAGE_STATE_GLYPHS = {
    staged: "●",
    unstaged: "○",
    mixed: "◐",
    conflicted: "!",
};
function stageStateGlyph(file) {
    return file.stageState ? STAGE_STATE_GLYPHS[file.stageState] : " ";
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
    rows.push({
        label: `${stageStateGlyph(info.file)} ${statusGlyph(info.file.status)} ${displayParts.at(-1) ?? info.file.path}${info.file.omission ? " (omitted)" : ""}`,
        fileIndex: info.index,
        depth: Math.max(0, displayParts.length - 1),
        isLast: true,
    });
}
export function buildTreeRows(files) {
    const rows = [];
    const seenDirs = new Set();
    const ordered = files
        .map((file, index) => ({ file, index }))
        .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.index - right.index);
    for (const info of ordered)
        addFileRow(rows, seenDirs, info);
    return rows;
}
//# sourceMappingURL=tree.js.map