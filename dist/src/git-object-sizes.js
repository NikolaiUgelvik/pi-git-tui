import { SUBMODULE_SOURCE_BYTES } from "./diff-budgets.js";
import { chunkLiteralPaths, nulRecords, pathAfterTab } from "./git-path-batches.js";
import { runGit, throwIfGitAborted } from "./git-service.js";
import { mapGitWorkers } from "./git-worker-pool.js";
const HEAD_SIZE_ARGS = ["--literal-pathspecs", "-c", "core.quotepath=false", "ls-tree", "-l", "-r", "-z"];
const INDEX_ENTRY_ARGS = [
    "--literal-pathspecs",
    "-c",
    "core.quotepath=false",
    "ls-files",
    "--stage",
    "-z",
    "--",
];
function objectSize(raw) {
    const bytes = Number(raw.trim());
    if (!Number.isSafeInteger(bytes) || bytes < 0)
        throw new Error("Git returned an invalid object size");
    return bytes;
}
function parseHeadSizeRecord(record) {
    const path = pathAfterTab(record);
    if (path === undefined)
        throw new Error("Malformed git ls-tree size output");
    const metadata = record.slice(0, record.indexOf("\t"));
    const match = /^([0-7]{6}) (?:blob|tree|commit) [0-9a-f]+\s+(-|\d+)$/iu.exec(metadata);
    if (!match)
        throw new Error("Malformed git ls-tree size metadata");
    return { path, bytes: match[2] === "-" ? SUBMODULE_SOURCE_BYTES : Number(match[2]) };
}
export async function loadHeadPathSizes(pi, root, revision, paths, budget, signal) {
    const fixedArgs = [...HEAD_SIZE_ARGS, revision, "--"];
    const sizes = new Map();
    for (const batch of chunkLiteralPaths(paths, budget, fixedArgs)) {
        throwIfGitAborted(signal);
        const result = await runGit(pi, root, [...fixedArgs, ...batch], { signal });
        for (const record of nulRecords(result.stdout)) {
            const parsed = parseHeadSizeRecord(record);
            sizes.set(parsed.path, parsed.bytes);
        }
    }
    return sizes;
}
function parseIndexEntry(record) {
    const path = pathAfterTab(record);
    if (path === undefined)
        throw new Error("Malformed git ls-files --stage output");
    const metadata = record.slice(0, record.indexOf("\t"));
    const match = /^([0-7]{6}) ([0-9a-f]+) ([0-3])$/iu.exec(metadata);
    if (!match)
        throw new Error("Malformed git ls-files --stage metadata");
    return { path, mode: match[1] ?? "000000", oid: match[2] ?? "" };
}
async function loadIndexEntries(pi, root, paths, budget, signal) {
    const entries = [];
    const identityParts = [];
    for (const batch of chunkLiteralPaths(paths, budget, INDEX_ENTRY_ARGS)) {
        throwIfGitAborted(signal);
        const result = await runGit(pi, root, [...INDEX_ENTRY_ARGS, ...batch], { signal });
        identityParts.push(result.stdout);
        entries.push(...nulRecords(result.stdout).map(parseIndexEntry));
    }
    return { entries, identity: identityParts.join("") };
}
export async function loadIndexPathIdentity(pi, root, paths, budget, signal) {
    return (await loadIndexEntries(pi, root, paths, budget, signal)).identity;
}
export async function loadIndexPathSizes(pi, root, paths, budget, signal) {
    const snapshot = await loadIndexEntries(pi, root, paths, budget, signal);
    const entries = snapshot.entries;
    const objectIds = [
        ...new Set(entries.filter((entry) => entry.mode !== "160000" && !/^0+$/u.test(entry.oid)).map((entry) => entry.oid)),
    ];
    const measured = await mapGitWorkers(objectIds, budget.concurrency, async (oid, _index, workerSignal) => {
        const result = await runGit(pi, root, ["cat-file", "-s", oid], { signal: workerSignal });
        return objectSize(result.stdout);
    }, signal);
    const objectSizes = new Map(objectIds.map((oid, index) => [oid, measured[index]]));
    const sizes = new Map();
    const changedPaths = new Set();
    for (const entry of entries) {
        const bytes = entry.mode === "160000" ? SUBMODULE_SOURCE_BYTES : objectSizes.get(entry.oid);
        if (bytes === undefined) {
            changedPaths.add(entry.path);
        }
        else {
            sizes.set(entry.path, Math.max(sizes.get(entry.path) ?? 0, bytes));
        }
    }
    return { sizes, changedPaths, identity: snapshot.identity };
}
//# sourceMappingURL=git-object-sizes.js.map