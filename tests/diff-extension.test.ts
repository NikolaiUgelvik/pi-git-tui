import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import type { KeyId } from "@earendil-works/pi-tui"
import gitDiffExtension, { getDiffShortcut } from "../extensions/diff.js"

test("extension source avoids deep pi-tui imports unsupported by Pi loader aliases", () => {
  const overlaySource = readFileSync(join(process.cwd(), "src/viewer-overlay-base.ts"), "utf8")

  assert.doesNotMatch(overlaySource, /@earendil-works\/pi-tui\//)
})

test("exports a Pi extension factory", () => {
  const extensionFactory: unknown = gitDiffExtension

  assert.equal(typeof extensionFactory, "function")
})

test("uses the macOS Command-key shortcut on darwin", () => {
  const expectedShortcut = "super+shift+g" satisfies KeyId

  assert.equal(getDiffShortcut("darwin"), expectedShortcut)
})

test("uses the Ctrl shortcut off macOS", () => {
  const expectedShortcut = "ctrl+shift+g" satisfies KeyId

  assert.equal(getDiffShortcut("linux"), expectedShortcut)
})

test("registers the diff command and platform shortcut", () => {
  const commands: Array<{
    name: string
    options: Parameters<ExtensionAPI["registerCommand"]>[1]
  }> = []
  const shortcuts: Array<{
    shortcut: KeyId
    options: Parameters<ExtensionAPI["registerShortcut"]>[1]
  }> = []

  const pi: Pick<ExtensionAPI, "registerCommand" | "registerShortcut"> = {
    registerCommand: (name, options) => commands.push({ name, options }),
    registerShortcut: (shortcut, options) => shortcuts.push({ shortcut, options }),
  }

  gitDiffExtension(pi as ExtensionAPI)

  assert.equal(commands.length, 1)
  assert.equal(commands[0]?.name, "diff")
  assert.match(commands[0]?.options.description ?? "", /git diff/i)
  assert.equal(typeof commands[0]?.options.handler, "function")

  assert.equal(shortcuts.length, 1)
  assert.equal(shortcuts[0]?.shortcut, getDiffShortcut())
  assert.match(shortcuts[0]?.options.description ?? "", /git diff/i)
  assert.equal(typeof shortcuts[0]?.options.handler, "function")
})

test("initial cancellation is silent and does not open the viewer", async () => {
  let commandHandler: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] | undefined
  let execCalls = 0
  let customCalls = 0
  const pi = {
    registerCommand: (_name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
      commandHandler = options.handler
    },
    registerShortcut: () => {},
    exec: async () => {
      execCalls++
      return { stdout: "", stderr: "", code: 0, killed: false }
    },
  } as unknown as ExtensionAPI
  gitDiffExtension(pi)
  const controller = new AbortController()
  controller.abort()
  const ctx = {
    cwd: "/repo",
    signal: controller.signal,
    hasUI: true,
    ui: {
      custom: async () => {
        customCalls++
      },
      notify: () => {},
    },
  } as unknown as ExtensionCommandContext

  await commandHandler?.("", ctx)

  assert.equal(execCalls, 0)
  assert.equal(customCalls, 0)
})
