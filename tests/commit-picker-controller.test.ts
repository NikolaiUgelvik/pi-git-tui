import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { CommitPickerController } from "../src/commit-picker-controller.js"
import type { CommitSummary } from "../src/types.js"

// --- Test harness ---

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const mockCommits: CommitSummary[] = [
  { hash: "abc1234", message: "feat: add feature A" },
  { hash: "def5678", message: "fix: resolve bug B" },
  { hash: "ghi9012", message: "docs: update README" },
]

function createController(
  opts: { onSelectWorkingTreeSpy?: () => void; onSelectCommitSpy?: (commit: CommitSummary) => void } = {},
) {
  let closed = false
  let renderCalled = false
  let selectedWorkingTree = false
  let selectedCommit: CommitSummary | undefined

  const callbacks = {
    onSelectWorkingTree: async () => {
      selectedWorkingTree = true
      opts.onSelectWorkingTreeSpy?.()
    },
    onSelectCommit: async (commit: CommitSummary) => {
      selectedCommit = commit
      opts.onSelectCommitSpy?.(commit)
    },
    onClose: () => {
      closed = true
    },
    onRequestRender: () => {
      renderCalled = true
    },
  }
  const controller = new CommitPickerController(callbacks)
  return {
    controller,
    callbacks,
    get closed() {
      return closed
    },
    get renderCalled() {
      return renderCalled
    },
    get selectedWorkingTree() {
      return selectedWorkingTree
    },
    get selectedCommit() {
      return selectedCommit
    },
  }
}

// --- Opening the picker ---

test("opening with commits sets state to open", () => {
  const { controller } = createController()
  assert.equal(controller.state, "closed")
  controller.open(mockCommits)
  assert.equal(controller.state, "open")
  assert.equal(controller.isOpen(), true)
})

test("opening with commits populates items (working tree + commits)", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  assert.equal(controller.list.items.length, 4) // 1 working + 3 commits
  assert.equal(controller.list.items[0].type, "working")
  assert.equal(controller.list.items[1].type, "commit")
  assert.equal(controller.totalCommits, 3)
})

test("opening resets list state", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  assert.equal(controller.list.searchQuery, "")
  assert.equal(controller.list.selectedIndex, 0)
  assert.equal(controller.list.scroll, 0)
})

test("opening requests render", () => {
  const h = createController()
  h.controller.open(mockCommits)
  assert.equal(h.renderCalled, true)
})

test("opening with empty commits list", () => {
  const { controller } = createController()
  controller.open([])
  assert.equal(controller.list.items.length, 1) // just working tree
  assert.equal(controller.totalCommits, 0)
})

// --- Search filtering ---

test("search filters commits by message", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("feat")
  assert.equal(controller.list.filteredCount, 1)
  const item = controller.list.get(0)
  assert.equal(item?.type, "commit")
  if (item?.type === "commit") {
    assert.equal(item.commit.hash, "abc1234")
  }
})

test("search filters commits by hash", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("abc")
  assert.equal(controller.list.filteredCount, 1)
})

test("search may hide working tree item", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("feat")
  // "feat" doesn't match "working tree staged unstaged"
  assert.equal(controller.list.filteredCount, 1)
  assert.equal(controller.list.get(0)?.type, "commit")
})

test("search for 'working' shows working tree item", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("working")
  assert.equal(controller.list.filteredCount, 1)
  assert.equal(controller.list.get(0)?.type, "working")
})

test("backspace clears search", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("f")
  controller.handleInput("e")
  controller.handleInput("a")
  controller.handleInput("t")
  assert.equal(controller.list.searchQuery, "feat")
  controller.handleInput("\b")
  assert.equal(controller.list.searchQuery, "fea")
})

// --- Navigation ---

test("navigation moves selection down", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("\x1b[B") // down arrow
  assert.equal(controller.list.selectedIndex, 1)
})

test("navigation moves selection up", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("\x1b[B") // down
  controller.handleInput("\x1b[B") // down
  assert.equal(controller.list.selectedIndex, 2)
  controller.handleInput("\x1b[A") // up
  assert.equal(controller.list.selectedIndex, 1)
})

test("navigation clamps to valid range", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  // Move past end
  for (let i = 0; i < 10; i++) {
    controller.handleInput("\x1b[B")
  }
  assert.equal(controller.list.selectedIndex, 3) // last index (4 items - 1)
})

test("navigation with home key", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("\x1b[B")
  controller.handleInput("\x1b[B")
  controller.handleInput("\x1b[H") // home
  assert.equal(controller.list.selectedIndex, 0)
})

test("navigation with end key", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("\x1b[F") // end
  assert.equal(controller.list.selectedIndex, 3)
})

// --- Selection ---

test("enter on working tree calls onSelectWorkingTree", async () => {
  const h = createController()
  h.controller.open(mockCommits)
  h.controller.handleInput("\n") // enter on index 0 (working tree)
  assert.equal(h.selectedWorkingTree, true)
})

test("enter on commit calls onSelectCommit", async () => {
  const h = createController()
  h.controller.open(mockCommits)
  h.controller.handleInput("\x1b[B") // move to index 1 (first commit)
  h.controller.handleInput("\n")
  assert.equal(h.selectedCommit?.hash, "abc1234")
})

test("escape closes the picker", () => {
  const h = createController()
  h.controller.open(mockCommits)
  h.controller.handleInput("\x1b") // escape
  assert.equal(h.closed, true)
  assert.equal(h.controller.state, "closed")
})

// --- Close ---

test("close resets state", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.close()
  assert.equal(controller.state, "closed")
  assert.equal(controller.isOpen(), false)
})

// --- Rendering ---

test("renderOverlayLines produces correct structure", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  // Border top, title, subtitle, search, blank, items..., blank, border bottom
  assert.ok(lines.length >= 8)
  assert.ok(lines[0].includes("╭") || lines[0].includes("─"))
  assert.ok(lines[lines.length - 1].includes("╰") || lines[lines.length - 1].includes("─"))
})

test("renderOverlayLines shows working tree as first item", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  // First item line is at index 5 (after border, title, subtitle, search, blank)
  const firstItemLine = lines[5]
  assert.ok(firstItemLine.includes("working tree"))
})

test("renderOverlayLines shows commit hash and message", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  const secondItemLine = lines[6]
  assert.ok(secondItemLine.includes("abc1234"))
  assert.ok(secondItemLine.includes("feat: add feature A"))
})

test("renderOverlayLines in loading state shows loading message", () => {
  const { controller } = createController()
  controller.state = "loading"
  controller.loadingMessage = "Loading commits…"
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  assert.ok(lines.join("").includes("Loading commits…"))
})

test("renderOverlayLines with no items shows empty message", () => {
  const { controller } = createController()
  controller.open([])
  controller.handleInput("zzzzz") // search that matches nothing
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  assert.ok(lines.join("").includes("No matching commits"))
})

test("renderOverlayLines shows match count when searching", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.handleInput("feat")
  const lines = controller.renderOverlayLines(20, 80, mockTheme)
  assert.ok(lines.join("").includes("(1/3)"))
})

// --- Loading state blocks input ---

test("input is ignored during loading state", () => {
  const { controller } = createController()
  controller.open(mockCommits)
  controller.state = "loading"
  controller.handleInput("\x1b[B") // down arrow
  assert.equal(controller.list.selectedIndex, 0) // should not change
})
