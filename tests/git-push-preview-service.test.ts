import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { failureDetails } from "../src/failure-details.js"
import { parseForcePushPreview, previewForcePush, redactPushDestination } from "../src/git-push-preview-service.js"
import { GIT_COMMANDS } from "../src/types.js"
import { gitResult } from "./helpers/viewer.js"

const forcePush = GIT_COMMANDS.find((command) => command.risk.kind === "force-push")
assert.ok(forcePush)

test("force-push preview delegates destination resolution to Git", async () => {
  const calls: string[][] = []
  const pi = {
    exec: async (_command: string, args: string[]) => {
      calls.push(args)
      if (args.join(" ") === "rev-parse --show-toplevel") {
        return gitResult("/repo\n")
      }
      return gitResult(
        [
          "To https://token:secret@example.com/org/repo.git",
          "+\trefs/heads/main:refs/heads/main\tabc123..def456 (forced update)",
          "=\trefs/heads/topic:refs/heads/topic\t[up to date]",
          "Done",
        ].join("\n"),
      )
    },
  } as ExtensionAPI

  const preview = await previewForcePush(pi, "/repo", forcePush)

  assert.deepEqual(calls, [
    ["rev-parse", "--show-toplevel"],
    ["push", "--force-with-lease", "--dry-run", "--porcelain"],
  ])
  assert.equal(preview.command, "git push --force-with-lease")
  assert.equal(preview.destination, "https://example.com/org/repo.git")
  assert.deepEqual(preview.updates, [
    {
      flag: "+",
      source: "refs/heads/main",
      destination: "refs/heads/main",
      summary: "abc123..def456 (forced update)",
    },
    {
      flag: "=",
      source: "refs/heads/topic",
      destination: "refs/heads/topic",
      summary: "[up to date]",
    },
  ])
})

test("porcelain parser accepts destination output on stderr", () => {
  const preview = parseForcePushPreview(
    forcePush,
    ["push", "--force-with-lease", "--dry-run", "--porcelain"],
    gitResult("+\trefs/heads/main:refs/heads/main\t[forced update]\n", 0, "To git@example.com:org/repo.git\n"),
  )

  assert.equal(preview.destination, "git@example.com:org/repo.git")
  assert.equal(preview.updates.length, 1)
})

test("URL credential redaction preserves non-credential SSH destinations", () => {
  assert.equal(redactPushDestination("https://user:secret@example.com/repo.git"), "https://example.com/repo.git")
  assert.equal(redactPushDestination("ssh://git@example.com/repo.git"), "ssh://example.com/repo.git")
  assert.equal(redactPushDestination("git@example.com:repo.git"), "git@example.com:repo.git")
})

test("failed dry run rejects before a real push can be confirmed", async () => {
  const calls: string[][] = []
  const pi = {
    exec: async (_command: string, args: string[]) => {
      calls.push(args)
      return args[0] === "rev-parse"
        ? gitResult("/repo\n")
        : gitResult("", 1, "fatal: https://token:secret@example.com/repo.git has no upstream branch configured")
    },
  } as ExtensionAPI

  await assert.rejects(
    () => previewForcePush(pi, "/repo", forcePush),
    (error: unknown) => {
      const rendered = JSON.stringify({ error, failure: failureDetails(error, "preview failed") })
      assert.doesNotMatch(rendered, /token:secret/u)
      assert.match(rendered, /https:\/\/example\.com\/repo\.git/u)
      assert.match(rendered, /no upstream branch configured/u)
      return true
    },
  )
  assert.equal(
    calls.some((args) => args.includes("--dry-run")),
    true,
  )
  assert.equal(
    calls.some((args) => !args.includes("--dry-run") && args[0] === "push"),
    false,
  )
})

test("a successful dry run without a destination redacts diagnostic output", () => {
  assert.throws(
    () =>
      parseForcePushPreview(
        forcePush,
        ["push", "--force-with-lease", "--dry-run", "--porcelain"],
        gitResult(
          "Everything up-to-date\n",
          0,
          "remote https://token:secret@example.com/repo.git did not report a destination",
        ),
      ),
    (error: unknown) => {
      const rendered = JSON.stringify({ error, failure: failureDetails(error, "preview failed") })
      assert.doesNotMatch(rendered, /token:secret/u)
      assert.match(rendered, /https:\/\/example\.com\/repo\.git/u)
      assert.match(rendered, /destination could not be resolved/u)
      return true
    },
  )
})
