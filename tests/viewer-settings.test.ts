import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { DiffFile } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { flushPromises } from "./helpers/deferred.js"
import { testSettingsListTheme, testTheme, workingDocument } from "./helpers/viewer.js"

const longFile: DiffFile = {
  path: "long.ts",
  status: "modified",
  stageState: "unstaged",
  lines: ["@@ -1 +1 @@", "+const value = 'a very long diff line that needs wrapping in a narrow panel'"],
}

class SettingsViewer extends DiffViewer {
  wrapping(): boolean {
    return this.pluginSettings.diff.wrap
  }
}

function viewer(wrap: boolean, saveSettings: (settings: { diff: { wrap: boolean } }) => Promise<void>): SettingsViewer {
  return new SettingsViewer(
    {} as ExtensionAPI,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: [longFile] }),
    () => {},
    () => {},
    () => 18,
    { settings: { diff: { wrap } }, settingsListTheme: () => testSettingsListTheme, saveSettings },
  )
}

test("viewer settings save wrapping from an in-diff overlay", async () => {
  const saved: boolean[] = []
  const diffViewer = viewer(true, async (settings) => {
    saved.push(settings.diff.wrap)
  })

  assert.match(diffViewer.render(80).join("\n"), /Diff.*wrap/u)
  diffViewer.handleInput("S")
  assert.match(diffViewer.render(80).join("\n"), /Pi Git TUI settings/u)
  assert.match(diffViewer.render(80).join("\n"), /Wrap diff lines.*on/u)

  diffViewer.handleInput(" ")
  assert.match(diffViewer.render(80).join("\n"), /Wrap diff lines.*off/u)
  diffViewer.handleInput("\x13")
  await flushPromises()

  assert.deepEqual(saved, [false])
  assert.equal(diffViewer.wrapping(), false)
  assert.doesNotMatch(diffViewer.render(80).join("\n"), /Pi Git TUI settings/u)
  assert.doesNotMatch(diffViewer.render(80).join("\n"), /Diff.*wrap/u)
})

test("escaping viewer settings discards the draft", async () => {
  let saves = 0
  const diffViewer = viewer(true, async () => {
    saves++
  })

  diffViewer.handleInput("S")
  diffViewer.handleInput(" ")
  diffViewer.handleInput("\x1b")
  await flushPromises()

  assert.equal(saves, 0)
  assert.equal(diffViewer.wrapping(), true)
  assert.doesNotMatch(diffViewer.render(80).join("\n"), /Pi Git TUI settings/u)
})

test("settings save failures stay visible and keep the active preference", async () => {
  const diffViewer = viewer(true, async () => {
    throw new Error("disk is read-only")
  })

  diffViewer.handleInput("S")
  diffViewer.handleInput(" ")
  diffViewer.handleInput("\x13")
  await flushPromises()

  const rendered = diffViewer.render(80).join("\n")
  assert.equal(diffViewer.wrapping(), true)
  assert.match(rendered, /Could not save settings: disk is read-only/u)
  assert.match(rendered, /Pi Git TUI settings/u)
})
