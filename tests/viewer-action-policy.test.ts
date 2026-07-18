import assert from "node:assert/strict"
import { test } from "node:test"
import { buildCommitDocument } from "../src/diff-document.js"
import { isViewerActionAvailable, type ViewerAction, viewerActionAvailability } from "../src/viewer-action-policy.js"
import { workingDocument } from "./helpers/viewer.js"

const allActions: ViewerAction[] = [
  "navigate",
  "reload",
  "toggleView",
  "stageFile",
  "stageAll",
  "commit",
  "discard",
  "initialize",
  "branches",
  "stashes",
  "commands",
  "commitPicker",
  "workingTree",
  "worktrees",
  "help",
  "close",
]

const working = workingDocument()
const historical = buildCommitDocument({
  title: "Commit abc123",
  subtitle: "/repo • historical",
  raw: "",
  commit: { hash: "abc123", message: "historical" },
})
const missing = workingDocument("/repo", { repositoryState: "missing" })

const expected = new Map([
  [
    "working",
    new Set<ViewerAction>([
      "navigate",
      "reload",
      "toggleView",
      "stageFile",
      "stageAll",
      "commit",
      "discard",
      "branches",
      "stashes",
      "commands",
      "commitPicker",
      "worktrees",
      "help",
      "close",
    ]),
  ],
  [
    "historical",
    new Set<ViewerAction>(["navigate", "reload", "commitPicker", "workingTree", "worktrees", "help", "close"]),
  ],
  ["missing", new Set<ViewerAction>(["navigate", "reload", "initialize", "help", "close"])],
])

for (const [label, document] of [
  ["working", working],
  ["historical", historical],
  ["missing", missing],
] as const) {
  test(`${label} document exposes only its policy actions`, () => {
    const available = allActions.filter((action) => isViewerActionAvailable(document, action))
    assert.deepEqual(new Set(available), expected.get(label))
  })
}

test("historical mutation failures direct the user to W", () => {
  for (const action of [
    "stageFile",
    "stageAll",
    "commit",
    "discard",
    "initialize",
    "branches",
    "stashes",
    "commands",
  ] as const) {
    const availability = viewerActionAvailability(historical, action)
    assert.equal(availability.available, false)
    assert.match(availability.reason ?? "", /^Return to the working tree with W before /u)
  }
})
