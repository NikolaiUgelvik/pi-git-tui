import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createTag, getTags, parseTagList } from "../src/git-tag-service.js"
import { realGitPi, runRealGit } from "./helpers/real-git.js"

test("parseTagList distinguishes annotated and lightweight tag metadata", () => {
  const output = [
    [
      "v2.0.0",
      "tag",
      "tag0001",
      "commit",
      "abc1234",
      "2026-07-24",
      "Release Bot",
      "",
      "Alice",
      "Version 2",
      "Add tag interface",
    ].join("\0"),
    ["nightly", "commit", "def5678", "", "", "2026-07-23", "", "Bob", "", "Nightly build", ""].join("\0"),
  ].join("\n")

  assert.deepEqual(parseTagList(output), [
    {
      name: "v2.0.0",
      annotated: true,
      targetHash: "abc1234",
      targetType: "commit",
      createdAt: "2026-07-24",
      creator: "Release Bot",
      annotation: "Version 2",
      targetSubject: "Add tag interface",
    },
    {
      name: "nightly",
      annotated: false,
      targetHash: "def5678",
      targetType: "commit",
      createdAt: "2026-07-23",
      creator: "Bob",
      annotation: undefined,
      targetSubject: "Nightly build",
    },
  ])
})

test("tag operations run directly from the provided repository path", async () => {
  const calls: Array<{ args: string[]; cwd?: string }> = []
  const pi = {
    exec: async (_command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ args, cwd: options?.cwd })
      return { stdout: "", stderr: "", code: 0, killed: false }
    },
  } as ExtensionAPI

  await getTags(pi, "/repo")
  await createTag(pi, "/repo", "snapshot", "abc1234", false)

  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.args[0], "for-each-ref")
  assert.deepEqual(calls[1]?.args, ["tag", "--", "snapshot", "abc1234"])
  assert.deepEqual(
    calls.map((call) => call.cwd),
    ["/repo", "/repo"],
  )
})

test("createTag and getTags round-trip annotated and lightweight tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-tui-tags-"))
  try {
    runRealGit(root, ["init", "--quiet", "--initial-branch=main"])
    runRealGit(root, ["config", "user.email", "tests@example.com"])
    runRealGit(root, ["config", "user.name", "Tests"])
    await writeFile(join(root, "file.txt"), "first\n")
    runRealGit(root, ["add", "file.txt"])
    runRealGit(root, ["commit", "--quiet", "-m", "First commit"])
    const first = runRealGit(root, ["rev-parse", "--short", "HEAD"]).trim()
    await writeFile(join(root, "file.txt"), "second\n")
    runRealGit(root, ["commit", "--quiet", "-am", "Second commit"])
    const second = runRealGit(root, ["rev-parse", "--short", "HEAD"]).trim()
    const secondAuthor = runRealGit(root, ["show", "-s", "--format=%an", second]).trim()

    assert.equal(
      await createTag(realGitPi(), root, "v1.0.0", first, true, "Version one"),
      `Created annotated tag v1.0.0 at ${first}`,
    )
    assert.equal(
      await createTag(realGitPi(), root, "snapshot", second, false),
      `Created lightweight tag snapshot at ${second}`,
    )

    const tags = await getTags(realGitPi(), root)
    const annotated = tags.find((tag) => tag.name === "v1.0.0")
    const lightweight = tags.find((tag) => tag.name === "snapshot")
    assert.ok(annotated)
    assert.equal(annotated.annotated, true)
    assert.equal(annotated.annotation, "Version one")
    assert.equal(annotated.targetSubject, "First commit")
    assert.equal(annotated.creator, "Tests")
    assert.ok(first.startsWith(annotated.targetHash) || annotated.targetHash.startsWith(first))
    assert.ok(lightweight)
    assert.equal(lightweight.annotated, false)
    assert.equal(lightweight.targetSubject, "Second commit")
    assert.equal(lightweight.creator, secondAuthor)
    assert.ok(second.startsWith(lightweight.targetHash) || lightweight.targetHash.startsWith(second))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("annotated tags reject an empty message before invoking git", async () => {
  await assert.rejects(
    () => createTag({} as never, "/not-used", "v1", "abc1234", true, ""),
    /Annotated tags require a message/u,
  )
})
