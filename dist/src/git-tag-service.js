import { runGit } from "./git-service.js";
const TAG_LIST_FORMAT = [
    "%(refname:short)",
    "%(objecttype)",
    "%(objectname:short)",
    "%(*objecttype)",
    "%(*objectname:short)",
    "%(creatordate:short)",
    "%(taggername)",
    "%(authorname)",
    "%(*authorname)",
    "%(subject)",
    "%(*subject)",
].join("%00");
function tagTargetType(value) {
    if (value === "commit" || value === "tree" || value === "blob" || value === "tag")
        return value;
    return "unknown";
}
function optional(value) {
    return value === "" ? undefined : value;
}
function firstPresent(primary, fallback) {
    return optional(primary) ?? optional(fallback);
}
function tagFields(line) {
    const [name, objectType, objectHash, peeledType, peeledHash, createdAt, taggerName, authorName, peeledAuthorName, subject, peeledSubject,] = line.split("\0").concat(Array(11).fill(""));
    return {
        name,
        objectType,
        objectHash,
        peeledType,
        peeledHash,
        createdAt,
        taggerName,
        authorName,
        peeledAuthorName,
        subject,
        peeledSubject,
    };
}
function annotatedTag(fields) {
    return {
        name: fields.name,
        annotated: true,
        targetHash: fields.peeledHash,
        targetType: tagTargetType(fields.peeledType),
        createdAt: optional(fields.createdAt),
        creator: firstPresent(fields.taggerName, fields.peeledAuthorName),
        annotation: optional(fields.subject),
        targetSubject: optional(fields.peeledSubject),
    };
}
function lightweightTag(fields) {
    return {
        name: fields.name,
        annotated: false,
        targetHash: fields.objectHash,
        targetType: tagTargetType(fields.objectType),
        createdAt: optional(fields.createdAt),
        creator: optional(fields.authorName),
        annotation: undefined,
        targetSubject: optional(fields.subject),
    };
}
function parseTagLine(line) {
    const fields = tagFields(line);
    return fields.objectType === "tag" ? annotatedTag(fields) : lightweightTag(fields);
}
export function parseTagList(output) {
    return output.split("\n").filter(Boolean).map(parseTagLine);
}
export async function getTags(pi, cwd, signal) {
    const result = await runGit(pi, cwd, ["for-each-ref", "--sort=-creatordate", `--format=${TAG_LIST_FORMAT}`, "refs/tags"], { signal });
    return parseTagList(result.stdout);
}
export async function createTag(pi, cwd, name, target, annotated, message, signal) {
    const annotation = message?.trim();
    if (annotated && !annotation)
        throw new Error("Annotated tags require a message");
    const args = annotated ? ["tag", "-a", "-m", annotation, "--", name, target] : ["tag", "--", name, target];
    await runGit(pi, cwd, args, { signal, timeoutClass: "mutation" });
    return `Created ${annotated ? "annotated" : "lightweight"} tag ${name} at ${target}`;
}
//# sourceMappingURL=git-tag-service.js.map