import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { type TagCreation, TagPickerController } from "../src/tag-picker-controller.js"
import type { CommitSummary, TagSummary } from "../src/types.js"

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const tags: TagSummary[] = [
  {
    name: "v2.0.0",
    annotated: true,
    targetHash: "abc1234",
    targetType: "commit",
    createdAt: "2026-07-24",
    creator: "Release Bot",
    annotation: "Version two",
    targetSubject: "Add tags",
  },
  {
    name: "nightly",
    annotated: false,
    targetHash: "def5678",
    targetType: "commit",
    createdAt: "2026-07-23",
    creator: "Alice",
    targetSubject: "Nightly build",
  },
]

const commits: CommitSummary[] = [
  { hash: "abc1234", message: "Add tags" },
  { hash: "def5678", message: "Prepare release" },
]

function harness() {
  let selected: TagSummary | undefined
  let requestedTargets = 0
  let creation: TagCreation | undefined
  let validation: string | undefined
  let closed = false
  let renders = 0
  const controller = new TagPickerController({
    onSelect: (tag) => {
      selected = tag
    },
    onRequestTargets: () => {
      requestedTargets += 1
    },
    onCreate: (input) => {
      creation = input
    },
    onValidationError: (message) => {
      validation = message
    },
    onClose: () => {
      closed = true
    },
    onRequestRender: () => {
      renders += 1
    },
  })
  return {
    controller,
    get selected() {
      return selected
    },
    get requestedTargets() {
      return requestedTargets
    },
    get creation() {
      return creation
    },
    get validation() {
      return validation
    },
    get closed() {
      return closed
    },
    get renders() {
      return renders
    },
  }
}

test("tag list searches names and metadata and selects a tag", () => {
  const h = harness()
  h.controller.open(tags)
  h.controller.handleInput("Release Bot")
  assert.equal(h.controller.list.filteredCount, 1)
  h.controller.handleInput("\r")
  assert.equal(h.selected?.name, "v2.0.0")
  assert.ok(h.renders > 0)
})

test("Ctrl+N requests the searchable target commit list", () => {
  const h = harness()
  h.controller.open(tags)
  h.controller.handleInput("\x0e")
  assert.equal(h.requestedTargets, 1)
  h.controller.openTargetSelection(commits)
  assert.equal(h.controller.state, "target")
  h.controller.handleInput("release")
  assert.equal(h.controller.commits.filteredCount, 1)
  h.controller.handleInput("\r")
  assert.equal(h.controller.state, "create")
  assert.deepEqual(h.controller.createTarget, commits[1])
})

test("Ctrl+T enables annotated creation with a required message", () => {
  const h = harness()
  h.controller.open(tags)
  h.controller.openTargetSelection(commits)
  h.controller.handleInput("\r")
  h.controller.handleInput("\x14")
  h.controller.handleInput("v3.0.0")
  h.controller.handleInput("\t")
  h.controller.handleInput("Version three")
  h.controller.handleInput("\r")

  assert.deepEqual(h.creation, {
    name: "v3.0.0",
    target: commits[0],
    annotated: true,
    message: "Version three",
  })
})

test("lightweight creation is the default and needs no annotation", () => {
  const h = harness()
  h.controller.openTargetSelection(commits)
  h.controller.handleInput("\r")
  h.controller.handleInput("snapshot")
  h.controller.handleInput("\r")

  assert.deepEqual(h.creation, {
    name: "snapshot",
    target: commits[0],
    annotated: false,
    message: undefined,
  })
})

test("creation validates tag names and annotated messages", () => {
  const h = harness()
  h.controller.openTargetSelection(commits)
  h.controller.handleInput("\r")
  h.controller.handleInput("\r")
  assert.equal(h.validation, "Tag name is empty")

  h.controller.handleInput("v1")
  h.controller.handleInput("\x14")
  h.controller.handleInput("\r")
  assert.equal(h.validation, "Annotated tag message is empty")
  assert.equal(h.creation, undefined)
})

test("Escape moves backward through creation before closing", () => {
  const h = harness()
  h.controller.open(tags)
  h.controller.openTargetSelection(commits)
  h.controller.handleInput("\r")
  h.controller.handleInput("\x1b")
  assert.equal(h.controller.state, "target")
  assert.equal(h.controller.createTarget, undefined)
  h.controller.handleInput("\x1b")
  assert.equal(h.controller.state, "open")
  h.controller.handleInput("\x1b")
  assert.equal(h.controller.state, "closed")
  assert.equal(h.closed, true)
})

test("loading ignores input", () => {
  const h = harness()
  h.controller.open(tags)
  h.controller.beginLoading("Loading tags…", "open")
  h.controller.handleInput("query")
  assert.equal(h.controller.list.searchQuery, "")
})

test("tag rows render type, target, date, creator, annotation, and commit subject", () => {
  const h = harness()
  h.controller.open(tags)
  const output = h.controller.renderOverlayLines(24, 140, mockTheme).join("\n")
  assert.match(output, /Tags/u)
  assert.match(output, /v2\.0\.0/u)
  assert.match(output, /annotated/u)
  assert.match(output, /abc1234/u)
  assert.match(output, /2026-07-24/u)
  assert.match(output, /Release Bot/u)
  assert.match(output, /Version two/u)
  assert.match(output, /Add tags/u)
})

test("target and creation steps render their current context", () => {
  const h = harness()
  h.controller.openTargetSelection(commits)
  assert.match(h.controller.renderOverlayLines(24, 120, mockTheme).join("\n"), /Select tag target/u)
  h.controller.handleInput("\r")
  let output = h.controller.renderOverlayLines(24, 120, mockTheme).join("\n")
  assert.match(output, /Create tag at abc1234/u)
  assert.match(output, /Name:/u)
  assert.match(output, /Type: lightweight/u)
  assert.doesNotMatch(output, /Message:/u)
  h.controller.handleInput("\x14")
  output = h.controller.renderOverlayLines(24, 120, mockTheme).join("\n")
  assert.match(output, /Type: annotated/u)
  assert.match(output, /Message:/u)
})
