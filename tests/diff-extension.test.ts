import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { KeyId } from "@earendil-works/pi-tui"
import gitDiffExtension, { getDiffShortcut } from "../extensions/diff.js"

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
