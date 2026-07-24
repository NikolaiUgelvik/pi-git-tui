import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { runGit } from "./git-service.js"
import type { TagSummary, TagTargetType } from "./types.js"

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
].join("%00")

interface TagFields {
  name: string
  objectType: string
  objectHash: string
  peeledType: string
  peeledHash: string
  createdAt: string
  taggerName: string
  authorName: string
  peeledAuthorName: string
  subject: string
  peeledSubject: string
}

function tagTargetType(value: string): TagTargetType {
  if (value === "commit" || value === "tree" || value === "blob" || value === "tag") return value
  return "unknown"
}

function optional(value: string): string | undefined {
  return value === "" ? undefined : value
}

function firstPresent(primary: string, fallback: string): string | undefined {
  return optional(primary) ?? optional(fallback)
}

function tagFields(line: string): TagFields {
  const [
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
  ] = line.split("\0").concat(Array(11).fill(""))
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
  }
}

function annotatedTag(fields: TagFields): TagSummary {
  return {
    name: fields.name,
    annotated: true,
    targetHash: fields.peeledHash,
    targetType: tagTargetType(fields.peeledType),
    createdAt: optional(fields.createdAt),
    creator: firstPresent(fields.taggerName, fields.peeledAuthorName),
    annotation: optional(fields.subject),
    targetSubject: optional(fields.peeledSubject),
  }
}

function lightweightTag(fields: TagFields): TagSummary {
  return {
    name: fields.name,
    annotated: false,
    targetHash: fields.objectHash,
    targetType: tagTargetType(fields.objectType),
    createdAt: optional(fields.createdAt),
    creator: optional(fields.authorName),
    annotation: undefined,
    targetSubject: optional(fields.subject),
  }
}

function parseTagLine(line: string): TagSummary {
  const fields = tagFields(line)
  return fields.objectType === "tag" ? annotatedTag(fields) : lightweightTag(fields)
}

export function parseTagList(output: string): TagSummary[] {
  return output.split("\n").filter(Boolean).map(parseTagLine)
}

export async function getTags(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<TagSummary[]> {
  const result = await runGit(
    pi,
    cwd,
    ["for-each-ref", "--sort=-creatordate", `--format=${TAG_LIST_FORMAT}`, "refs/tags"],
    { signal },
  )
  return parseTagList(result.stdout)
}

export async function createTag(
  pi: ExtensionAPI,
  cwd: string,
  name: string,
  target: string,
  annotated: boolean,
  message?: string,
  signal?: AbortSignal,
): Promise<string> {
  const annotation = message?.trim()
  if (annotated && !annotation) throw new Error("Annotated tags require a message")
  const args = annotated ? ["tag", "-a", "-m", annotation as string, "--", name, target] : ["tag", "--", name, target]
  await runGit(pi, cwd, args, { signal, timeoutClass: "mutation" })
  return `Created ${annotated ? "annotated" : "lightweight"} tag ${name} at ${target}`
}
