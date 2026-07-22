import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createPluginSettingsStore, DEFAULT_PLUGIN_SETTINGS } from "../src/plugin-settings.js"

async function withSettingsDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-git-tui-settings-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("missing plugin settings enable diff wrapping by default", async () => {
  await withSettingsDirectory(async (directory) => {
    const loaded = await createPluginSettingsStore(directory).load()

    assert.deepEqual(loaded.settings, DEFAULT_PLUGIN_SETTINGS)
    assert.equal(loaded.settings.diff.wrap, true)
    assert.equal(loaded.warning, undefined)
  })
})

test("plugin settings persist as formatted pi-git-tui.json", async () => {
  await withSettingsDirectory(async (directory) => {
    const store = createPluginSettingsStore(directory)
    await store.save({ diff: { wrap: false } })

    assert.equal(store.path, join(directory, "pi-git-tui.json"))
    assert.equal(await readFile(store.path, "utf8"), '{\n  "diff": {\n    "wrap": false\n  }\n}\n')
    assert.deepEqual(await store.load(), { settings: { diff: { wrap: false } } })
  })
})

test("invalid plugin settings warn and fall back to wrapping", async () => {
  await withSettingsDirectory(async (directory) => {
    const path = join(directory, "pi-git-tui.json")
    await writeFile(path, '{ "diff": { "wrap": "sometimes" } }\n')

    const loaded = await createPluginSettingsStore(directory).load()

    assert.equal(loaded.settings.diff.wrap, true)
    assert.match(loaded.warning ?? "", /expected.*wrap.*boolean/u)
  })
})

test("malformed plugin JSON warns without blocking the viewer default", async () => {
  await withSettingsDirectory(async (directory) => {
    await writeFile(join(directory, "pi-git-tui.json"), "{ nope")

    const loaded = await createPluginSettingsStore(directory).load()

    assert.equal(loaded.settings.diff.wrap, true)
    assert.match(loaded.warning ?? "", /invalid JSON/u)
  })
})
