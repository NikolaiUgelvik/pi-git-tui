const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
function cleanMetadataValue(line, prefix) {
    return line.slice(prefix.length).trim();
}
function parseHunkHeader(line) {
    const match = line.match(HUNK_HEADER);
    if (!match) {
        return;
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    const sectionText = match[5]?.trim();
    return {
        type: "hunk",
        ...(sectionText ? { sectionText } : {}),
        oldStart,
        oldCount,
        newStart,
        newCount,
    };
}
function prefixRule(prefix, apply) {
    return { matches: (line) => line.startsWith(prefix), apply };
}
const ignoreMetadata = () => { };
const METADATA_LINE_RULES = [
    prefixRule("diff --git ", ignoreMetadata),
    prefixRule("--- ", ignoreMetadata),
    prefixRule("+++ ", ignoreMetadata),
    prefixRule("index ", (_line, metadata) => {
        metadata.hasIndex = true;
    }),
    prefixRule("new file mode ", (_line, metadata) => {
        metadata.newFile = true;
    }),
    prefixRule("deleted file mode ", (_line, metadata) => {
        metadata.deletedFile = true;
    }),
    prefixRule("old mode ", (line, metadata) => {
        metadata.oldMode = cleanMetadataValue(line, "old mode ");
    }),
    prefixRule("new mode ", (line, metadata) => {
        metadata.newMode = cleanMetadataValue(line, "new mode ");
    }),
    prefixRule("similarity index ", (line, metadata) => {
        metadata.similarity = cleanMetadataValue(line, "similarity index ");
    }),
    prefixRule("rename from ", (line, metadata) => {
        metadata.renameFrom = cleanMetadataValue(line, "rename from ");
    }),
    prefixRule("rename to ", (line, metadata) => {
        metadata.renameTo = cleanMetadataValue(line, "rename to ");
    }),
    prefixRule("copy from ", (line, metadata) => {
        metadata.copyFrom = cleanMetadataValue(line, "copy from ");
    }),
    prefixRule("copy to ", (line, metadata) => {
        metadata.copyTo = cleanMetadataValue(line, "copy to ");
    }),
    prefixRule("Binary files ", (line, metadata) => {
        metadata.binary = line.trim();
    }),
    prefixRule("GIT binary patch", (_line, metadata) => {
        metadata.binaryPatch = true;
    }),
];
function updateMetadata(line, metadata) {
    const rule = METADATA_LINE_RULES.find(({ matches }) => matches(line));
    rule?.apply(line, metadata);
    return rule !== undefined;
}
function appendSimilarity(text, similarity) {
    return similarity ? `${text} (${similarity})` : text;
}
function summaryRow(text) {
    return text === undefined ? undefined : { type: "summary", text };
}
function moveSummary(kind, from, to, similarity) {
    return from && to ? appendSimilarity(`${kind} ${from} -> ${to}`, similarity) : undefined;
}
function modeSummary(metadata) {
    return metadata.oldMode && metadata.newMode ? `Mode changed ${metadata.oldMode} -> ${metadata.newMode}` : undefined;
}
function metadataRows(metadata) {
    const rows = [
        summaryRow(metadata.binary),
        summaryRow(metadata.binaryPatch ? "Binary patch" : undefined),
        summaryRow(moveSummary("Renamed", metadata.renameFrom, metadata.renameTo, metadata.similarity)),
        summaryRow(moveSummary("Copied", metadata.copyFrom, metadata.copyTo, metadata.similarity)),
        summaryRow(modeSummary(metadata)),
        summaryRow(metadata.newFile ? "New file" : undefined),
        summaryRow(metadata.deletedFile ? "Deleted file" : undefined),
    ].filter((row) => row !== undefined);
    return rows.length === 0 && metadata.hasIndex ? [{ type: "summary", text: "Metadata-only diff" }] : rows;
}
function hasHunkRows(rows) {
    return rows.some((row) => ["hunk", "context", "addition", "deletion"].includes(row.type));
}
function hunkState(row) {
    return { oldLine: row.oldStart, newLine: row.newStart };
}
function formatOutsideHunk(line, metadata) {
    return updateMetadata(line, metadata) ? undefined : { type: "unknown", text: line };
}
function formatHunkLine(line, hunk) {
    const marker = line.at(0);
    const text = line.slice(1);
    if (line === "\\ No newline at end of file") {
        return { type: "summary", text: "No newline at end of file" };
    }
    if (marker === " ") {
        const row = { type: "context", marker, lineNumber: hunk.newLine, text };
        hunk.oldLine += 1;
        hunk.newLine += 1;
        return row;
    }
    if (marker === "-") {
        const row = { type: "deletion", marker, lineNumber: hunk.oldLine, text };
        hunk.oldLine += 1;
        return row;
    }
    if (marker === "+") {
        const row = { type: "addition", marker, lineNumber: hunk.newLine, text };
        hunk.newLine += 1;
        return row;
    }
    return { type: "unknown", text: line };
}
function displayRows(rows, metadata) {
    if (!hasHunkRows(rows)) {
        const summaries = metadataRows(metadata);
        if (summaries.length > 0) {
            return [...summaries, ...rows.filter((row) => row.type === "unknown")];
        }
    }
    return rows.length === 0 ? [{ type: "summary", text: "No displayable diff" }] : rows;
}
function appendHunkHeader(state, line) {
    if (!line.startsWith("@@")) {
        return false;
    }
    const hunkRow = parseHunkHeader(line);
    if (!hunkRow) {
        state.rows.push({ type: "unknown", text: line });
        state.hunk = undefined;
        return true;
    }
    state.rows.push(hunkRow);
    state.hunk = hunkState(hunkRow);
    return true;
}
function appendDisplayLine(state, line) {
    if (state.suppressBinaryPayload || appendHunkHeader(state, line)) {
        return;
    }
    const row = state.hunk ? formatHunkLine(line, state.hunk) : formatOutsideHunk(line, state.metadata);
    state.suppressBinaryPayload = state.metadata.binaryPatch === true;
    if (row) {
        state.rows.push(row);
    }
}
function omissionRows(file) {
    if (!file.omission) {
        return;
    }
    return [
        { type: "summary", text: `Diff omitted for ${JSON.stringify(file.path)}` },
        { type: "summary", text: file.omission.message },
    ];
}
export function formatDiffDisplay(file) {
    const omitted = omissionRows(file);
    if (omitted) {
        return omitted;
    }
    const state = {
        rows: [],
        metadata: {},
        suppressBinaryPayload: false,
    };
    for (const line of file.lines) {
        appendDisplayLine(state, line);
    }
    return displayRows(state.rows, state.metadata);
}
//# sourceMappingURL=diff-display.js.map