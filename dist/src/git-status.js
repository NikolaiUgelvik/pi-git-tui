import { createHash } from "node:crypto";
import { runGit } from "./git-service.js";
import { isWorkingTreeSnapshotClean, workingTreeStatusFingerprint } from "./git-status-fingerprint.js";
export class GitStatusParseError extends Error {
    record;
    constructor(message, record) {
        super(message);
        this.name = "GitStatusParseError";
        this.record = record;
    }
}
const STATUS_ARGS = [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
    "--find-renames",
];
function parseFixedFields(record, marker, fieldCount) {
    const body = record.slice(marker.length);
    const fields = [];
    let offset = 0;
    for (let index = 0; index < fieldCount; index++) {
        const separator = body.indexOf(" ", offset);
        if (separator < 0) {
            throw new GitStatusParseError(`Malformed porcelain-v2 ${marker.trim()} record`, record);
        }
        const field = body.slice(offset, separator);
        if (!field) {
            throw new GitStatusParseError(`Empty porcelain-v2 ${marker.trim()} field`, record);
        }
        fields.push(field);
        offset = separator + 1;
    }
    const path = body.slice(offset);
    if (!path) {
        throw new GitStatusParseError(`Missing path in porcelain-v2 ${marker.trim()} record`, record);
    }
    fields.push(path);
    return fields;
}
function parseStatuses(value, record) {
    if (!/^[.MTADRCU]{2}$/u.test(value)) {
        throw new GitStatusParseError("Malformed porcelain-v2 XY status", record);
    }
    return [value[0] ?? ".", value[1] ?? "."];
}
function validateObjectFields(record, modes, oids) {
    if (modes.some((mode) => !/^[0-7]{6}$/u.test(mode))) {
        throw new GitStatusParseError("Malformed porcelain-v2 file mode", record);
    }
    if (oids.some((oid) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(oid))) {
        throw new GitStatusParseError("Malformed porcelain-v2 object ID", record);
    }
}
function validateSubmodule(value, record) {
    if (!/^(?:N\.\.\.|S[.C][.M][.U])$/u.test(value)) {
        throw new GitStatusParseError("Malformed porcelain-v2 submodule state", record);
    }
}
function objectExists(mode, oid) {
    return mode !== "000000" && !/^0+$/u.test(oid);
}
function recordIndexIdentity(builder, values) {
    builder.indexIdentityParts.push(values.join("\0"));
}
function recordEntry(builder, entry) {
    builder.entries.push(entry);
    if (entry.kind === "unmerged") {
        builder.conflictedPaths.add(entry.path);
    }
    else if (entry.indexStatus !== ".") {
        builder.stagedPaths.add(entry.path);
    }
}
function parseOrdinaryRecord(builder, record) {
    const [xy = "", submodule = "", headMode = "", indexMode = "", worktreeMode = "", headOid = "", indexOid = "", path = "",] = parseFixedFields(record, "1 ", 7);
    const [indexStatus, worktreeStatus] = parseStatuses(xy, record);
    validateSubmodule(submodule, record);
    validateObjectFields(record, [headMode, indexMode, worktreeMode], [headOid, indexOid]);
    recordEntry(builder, { kind: "ordinary", path, indexStatus, worktreeStatus, submodule });
    recordIndexIdentity(builder, ["ordinary", path, headMode, indexMode, headOid, indexOid]);
    if (objectExists(headMode, headOid)) {
        builder.headTrackedPaths.add(path);
    }
}
function parseSimilarity(value, record) {
    const match = /^([RC])(\d{1,3})$/u.exec(value);
    const score = Number(match?.[2]);
    if (!match || !Number.isInteger(score) || score < 0 || score > 100) {
        throw new GitStatusParseError("Malformed porcelain-v2 rename/copy score", record);
    }
    return { kind: match[1] === "R" ? "rename" : "copy", score };
}
function parseRenameRecord(builder, record, originalPath) {
    if (!originalPath) {
        throw new GitStatusParseError("Missing original path after porcelain-v2 rename/copy record", record);
    }
    const [xy = "", submodule = "", headMode = "", indexMode = "", worktreeMode = "", headOid = "", indexOid = "", score = "", path = "",] = parseFixedFields(record, "2 ", 8);
    const [indexStatus, worktreeStatus] = parseStatuses(xy, record);
    validateSubmodule(submodule, record);
    validateObjectFields(record, [headMode, indexMode, worktreeMode], [headOid, indexOid]);
    recordEntry(builder, {
        kind: "rename",
        path,
        originalPath,
        indexStatus,
        worktreeStatus,
        submodule,
        similarity: parseSimilarity(score, record),
    });
    recordIndexIdentity(builder, ["rename", originalPath, path, headMode, indexMode, headOid, indexOid]);
    if (objectExists(headMode, headOid)) {
        builder.headTrackedPaths.add(originalPath);
    }
}
function parseUnmergedRecord(builder, record) {
    const [xy = "", submodule = "", baseMode = "", oursMode = "", theirsMode = "", worktreeMode = "", baseOid = "", oursOid = "", theirsOid = "", path = "",] = parseFixedFields(record, "u ", 9);
    const [indexStatus, worktreeStatus] = parseStatuses(xy, record);
    validateSubmodule(submodule, record);
    validateObjectFields(record, [baseMode, oursMode, theirsMode, worktreeMode], [baseOid, oursOid, theirsOid]);
    recordEntry(builder, { kind: "unmerged", path, indexStatus, worktreeStatus, submodule });
    recordIndexIdentity(builder, ["unmerged", path, baseMode, oursMode, theirsMode, baseOid, oursOid, theirsOid]);
    if (objectExists(oursMode, oursOid)) {
        builder.headTrackedPaths.add(path);
    }
}
function parseHeader(headers, record) {
    const values = [
        ["# branch.oid ", (value) => (headers.oid = value)],
        ["# branch.head ", (value) => (headers.branch = value)],
        ["# branch.upstream ", (value) => (headers.upstream = value)],
    ];
    const known = values.find(([prefix]) => record.startsWith(prefix));
    if (known) {
        const value = record.slice(known[0].length);
        if (!value) {
            throw new GitStatusParseError(`Missing value for ${known[0].trim()}`, record);
        }
        known[1](value);
        return;
    }
    if (record.startsWith("# branch.ab ")) {
        const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(record);
        if (!match) {
            throw new GitStatusParseError("Malformed porcelain-v2 branch.ab header", record);
        }
        const ahead = Number(match[1]);
        const behind = Number(match[2]);
        if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
            throw new GitStatusParseError("Porcelain-v2 branch counts exceed safe integers", record);
        }
        headers.ahead = ahead;
        headers.behind = behind;
    }
}
function parseHead(headers) {
    if (!headers.oid || !headers.branch) {
        throw new GitStatusParseError("Porcelain-v2 status is missing branch.oid or branch.head");
    }
    if (headers.oid === "(initial)") {
        return { kind: "initial", branch: headers.branch };
    }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(headers.oid)) {
        throw new GitStatusParseError("Malformed porcelain-v2 branch OID");
    }
    if (headers.branch === "(detached)") {
        return { kind: "detached", oid: headers.oid };
    }
    return { kind: "attached", oid: headers.oid, branch: headers.branch };
}
export function parsePorcelainV2(raw) {
    const builder = {
        headers: {},
        entries: [],
        stagedPaths: new Set(),
        conflictedPaths: new Set(),
        untrackedPaths: [],
        headTrackedPaths: new Set(),
        indexIdentityParts: [],
    };
    const records = raw.split("\0");
    for (let index = 0; index < records.length; index++) {
        const record = records[index] ?? "";
        if (!record && index === records.length - 1) {
            continue;
        }
        if (!record) {
            throw new GitStatusParseError("Unexpected empty porcelain-v2 record");
        }
        if (record.startsWith("# ")) {
            parseHeader(builder.headers, record);
        }
        else if (record.startsWith("1 ")) {
            parseOrdinaryRecord(builder, record);
        }
        else if (record.startsWith("2 ")) {
            parseRenameRecord(builder, record, records[++index]);
        }
        else if (record.startsWith("u ")) {
            parseUnmergedRecord(builder, record);
        }
        else if (record.startsWith("? ")) {
            const path = record.slice(2);
            if (!path)
                throw new GitStatusParseError("Missing untracked path", record);
            builder.untrackedPaths.push(path);
        }
        else if (record.startsWith("! ")) {
            if (!record.slice(2))
                throw new GitStatusParseError("Missing ignored path", record);
        }
        else {
            throw new GitStatusParseError("Unknown porcelain-v2 record", record);
        }
    }
    const upstream = builder.headers.upstream
        ? {
            name: builder.headers.upstream,
            ...(builder.headers.ahead === undefined ? {} : { ahead: builder.headers.ahead }),
            ...(builder.headers.behind === undefined ? {} : { behind: builder.headers.behind }),
        }
        : undefined;
    const snapshot = {
        head: parseHead(builder.headers),
        upstream,
        entries: builder.entries,
        stagedPaths: builder.stagedPaths,
        conflictedPaths: builder.conflictedPaths,
        untrackedPaths: builder.untrackedPaths,
        headTrackedPaths: builder.headTrackedPaths,
        indexFingerprint: createHash("sha256").update(JSON.stringify(builder.indexIdentityParts)).digest("hex"),
    };
    return {
        ...snapshot,
        statusFingerprint: workingTreeStatusFingerprint(snapshot),
        clean: isWorkingTreeSnapshotClean(snapshot),
    };
}
export function workingTreeBranchLabel(snapshot) {
    const branch = snapshot.head.kind === "detached" ? `detached ${snapshot.head.oid.slice(0, 7)}` : snapshot.head.branch;
    const ahead = snapshot.upstream?.ahead ?? 0;
    const behind = snapshot.upstream?.behind ?? 0;
    const suffix = [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join(" ");
    return suffix ? `${branch} ${suffix}` : branch;
}
function branchFromSymbolicRef(ref) {
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}
function replaceSnapshotHead(snapshot, head) {
    const updated = { ...snapshot, head };
    return { ...updated, statusFingerprint: workingTreeStatusFingerprint(updated) };
}
async function validateInitialHead(pi, root, snapshot, signal) {
    const symbolicHead = await runGit(pi, root, ["symbolic-ref", "--quiet", "HEAD"], { signal });
    const ref = symbolicHead.stdout.trim();
    if (!ref) {
        throw new GitStatusParseError("Initial repository has no symbolic HEAD");
    }
    const refResult = await runGit(pi, root, ["show-ref", "--verify", "--quiet", ref], {
        signal,
        acceptedExitCodes: [0, 1],
    });
    if (refResult.code === 0) {
        throw new GitStatusParseError("Porcelain-v2 reported an initial repository whose HEAD ref exists");
    }
    return replaceSnapshotHead(snapshot, { kind: "initial", branch: branchFromSymbolicRef(ref) });
}
async function disambiguateDetachedHead(pi, root, snapshot, signal) {
    const symbolicHead = await runGit(pi, root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        signal,
        acceptedExitCodes: [0, 1],
    });
    if (symbolicHead.code === 1) {
        return snapshot;
    }
    const branch = symbolicHead.stdout.trim();
    if (!branch) {
        throw new GitStatusParseError("symbolic-ref returned an empty branch name");
    }
    if (snapshot.head.kind !== "detached") {
        throw new GitStatusParseError("Expected an ambiguous detached HEAD snapshot");
    }
    return replaceSnapshotHead(snapshot, { kind: "attached", oid: snapshot.head.oid, branch });
}
export async function loadWorkingTreeSnapshot(pi, root, signal) {
    const result = await runGit(pi, root, STATUS_ARGS, { signal });
    const snapshot = parsePorcelainV2(result.stdout);
    if (snapshot.head.kind === "initial") {
        return snapshot.head.branch === "(unknown)" ? validateInitialHead(pi, root, snapshot, signal) : snapshot;
    }
    if (snapshot.head.kind === "detached") {
        return disambiguateDetachedHead(pi, root, snapshot, signal);
    }
    return snapshot;
}
//# sourceMappingURL=git-status.js.map