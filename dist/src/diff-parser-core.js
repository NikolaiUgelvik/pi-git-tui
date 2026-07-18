import { decodeGitQuotedPath } from "./git-path-quote.js";
function dropDiffSidePrefix(value) {
    return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}
function unquoteGitPath(path) {
    const [encodedPath = path] = path.split("\t", 1);
    const value = encodedPath.startsWith('"')
        ? decodeGitQuotedPath(encodedPath)
        : decodeGitQuotedPath(dropDiffSidePrefix(encodedPath));
    return value === "/dev/null" ? value : dropDiffSidePrefix(value);
}
const DIFF_GIT_LINE = /^diff --git (.+) (.+)$/;
function quotedTokenEnd(value) {
    if (!value.startsWith('"'))
        return;
    for (let index = 1; index < value.length; index++) {
        if (value[index] === "\\") {
            index++;
        }
        else if (value[index] === '"') {
            return index;
        }
    }
}
function quotedDestination(body) {
    const firstEnd = quotedTokenEnd(body);
    if (firstEnd === undefined)
        return;
    const remainder = body.slice(firstEnd + 1).trimStart();
    const secondEnd = quotedTokenEnd(remainder);
    if (secondEnd === undefined || remainder.slice(secondEnd + 1).trim())
        return;
    return unquoteGitPath(remainder.slice(0, secondEnd + 1));
}
function samePathDestination(body) {
    let separator = body.indexOf(" b/");
    while (separator >= 0) {
        const oldPath = unquoteGitPath(body.slice(0, separator));
        const destination = body.slice(separator + 1);
        if (oldPath === unquoteGitPath(destination))
            return unquoteGitPath(destination);
        separator = body.indexOf(" b/", separator + 1);
    }
}
function pathFromDiffGit(line) {
    if (!line.startsWith("diff --git "))
        return;
    const body = line.slice("diff --git ".length);
    const precise = quotedDestination(body) ?? samePathDestination(body);
    if (precise)
        return precise;
    const match = line.match(DIFF_GIT_LINE);
    return match ? unquoteGitPath(match[2] ?? match[1] ?? "") : undefined;
}
function lineHasAnyPrefix(line, prefixes) {
    return prefixes.some((prefix) => line.startsWith(prefix));
}
const STATUS_LINE_RULES = [
    { status: "binary", matches: (line) => lineHasAnyPrefix(line, ["Binary files ", "GIT binary patch"]) },
    { status: "renamed", matches: (line) => line.startsWith("rename from ") },
    { status: "copied", matches: (line) => line.startsWith("copy from ") },
    { status: "added", matches: (line) => line.startsWith("new file mode ") },
    { status: "deleted", matches: (line) => line.startsWith("deleted file mode ") },
];
function statusFromPaths(oldPath, newPath) {
    if (oldPath === "/dev/null") {
        return "added";
    }
    return newPath === "/dev/null" ? "deleted" : "modified";
}
function statusFromLines(lines, oldPath, newPath) {
    return STATUS_LINE_RULES.find((rule) => lines.some(rule.matches))?.status ?? statusFromPaths(oldPath, newPath);
}
function normalizedDiffLines(raw) {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rawLines = normalized.length > 0 ? normalized.split("\n") : [];
    if (rawLines.at(-1) === "") {
        rawLines.pop();
    }
    return rawLines;
}
function startsNewDiffChunk(state, line) {
    return state.current.length > 0 && line.startsWith("diff --git ");
}
function flushCurrentChunk(state) {
    if (state.current.length === 0) {
        return;
    }
    state.chunks.push(state.current);
    state.current = [];
}
function appendDiffChunkLine(state, line) {
    if (startsNewDiffChunk(state, line)) {
        flushCurrentChunk(state);
    }
    state.current.push(line);
}
function diffChunks(lines) {
    const state = { chunks: [], current: [] };
    lines.forEach((line) => {
        appendDiffChunkLine(state, line);
    });
    flushCurrentChunk(state);
    return state.chunks;
}
const METADATA_LINE_RULES = [
    {
        prefix: "diff --git ",
        apply: (metadata, line) => {
            metadata.fallbackPath = pathFromDiffGit(line) ?? metadata.fallbackPath;
        },
    },
    {
        prefix: "--- ",
        apply: (metadata, line) => {
            metadata.oldPath = unquoteGitPath(line.slice(4));
        },
    },
    {
        prefix: "+++ ",
        apply: (metadata, line) => {
            metadata.newPath = unquoteGitPath(line.slice(4));
        },
    },
    {
        prefix: "rename to ",
        apply: (metadata, line) => {
            metadata.newPath = unquoteGitPath(line.slice("rename to ".length));
        },
    },
    {
        prefix: "rename from ",
        apply: (metadata, line) => {
            metadata.oldPath = unquoteGitPath(line.slice("rename from ".length));
        },
    },
];
function updateDiffMetadata(metadata, line) {
    METADATA_LINE_RULES.find((rule) => line.startsWith(rule.prefix))?.apply(metadata, line);
}
function extractDiffMetadata(lines) {
    const metadata = {};
    for (const line of lines) {
        updateDiffMetadata(metadata, line);
    }
    return metadata;
}
function usablePath(path) {
    return path !== undefined && path !== "/dev/null" ? path : undefined;
}
function displayPath(metadata) {
    return usablePath(metadata.newPath) ?? usablePath(metadata.oldPath) ?? metadata.fallbackPath ?? "(unknown)";
}
function diffFileFromChunk(lines) {
    const metadata = extractDiffMetadata(lines);
    return {
        path: displayPath(metadata),
        oldPath: metadata.oldPath,
        newPath: metadata.newPath,
        status: statusFromLines(lines, metadata.oldPath, metadata.newPath),
        staged: false,
        lines,
    };
}
export function parseDiff(raw) {
    return diffChunks(normalizedDiffLines(raw)).map(diffFileFromChunk);
}
//# sourceMappingURL=diff-parser-core.js.map