import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { WorktreeSummary } from "../src/types.js"
import { WorktreePickerController } from "../src/worktree-picker-controller.js"

// --- Test harness ---

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const sampleWorktrees: WorktreeSummary[] = [
  { path: "/repo", head: "abc123", branch: "main" },
  { path: "/repo-feature", head: "def456", branch: "feature/test" },
  { path: "/repo-bare", head: "ghi789", bare: true },
]

function createController(switchSpy?: (wt: WorktreeSummary) => void) {
  let closed = false
  let renderCalled = false
  const controller = new WorktreePickerController({
    onSwitch: async (worktree: WorktreeSummary) => {
      if (switchSpy) switchSpy(worktree)
    },
    onClose: () => {
      closed = true
    },
    onRequestRender: () => {
      renderCalled = true
    },
  })
  return {
    controller,
    get closed() {
      return closed
    },
    get renderCalled() {
      return renderCalled
    },
  }
}

// --- Opening the picker ---

test("opening the picker sets state to open", () => {
  const { controller } = createController()
  assert.equal(controller.state, "closed")
  controller.open(sampleWorktrees, "/repo")
  assert.equal(controller.state, "open")
  assert.equal(controller.isOpen(), true)
})

test("opening the picker initializes list with worktrees", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  assert.equal(controller.list.items.length, 3)
})

test("opening the picker resets list state", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  assert.equal(controller.list.searchQuery, "")
  assert.equal(controller.list.selectedIndex, 0)
  assert.equal(controller.list.scroll, 0)
})

test("opening the picker tracks activePath", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo-feature")
  assert.equal(controller.activePath, "/repo-feature")
})

test("opening the picker requests render", () => {
  const h = createController()
  h.controller.open(sampleWorktrees, "/repo")
  assert.equal(h.renderCalled, true)
})

// --- Closing the picker ---

test("closing the picker sets state to closed", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.close()
  assert.equal(controller.state, "closed")
  assert.equal(controller.isOpen(), false)
})

test("closing the picker calls onClose callback", () => {
  const h = createController()
  h.controller.open(sampleWorktrees, "/repo")
  h.controller.close()
  assert.equal(h.closed, true)
})

// --- Search ---

test("search filters worktrees by path", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("feature")
  assert.equal(controller.list.filteredCount, 1)
})

test("search filters worktrees by branch name", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("main")
  assert.equal(controller.list.filteredCount, 1)
})

test("printable punctuation belongs to worktree search", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("?*q")
  assert.equal(controller.list.searchQuery, "?*q")
})

test("backspace removes last search character", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("feature")
  controller.handleInput("\b")
  assert.equal(controller.list.searchQuery, "featur")
})

test("search with no matches shows zero filtered count", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("nonexistent")
  assert.equal(controller.list.filteredCount, 0)
})

// --- Navigation ---

test("down arrow moves selection down", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("\x1b[B")
  assert.equal(controller.list.selectedIndex, 1)
})

test("up arrow moves selection up", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.list.selectedIndex = 1
  controller.handleInput("\x1b[A")
  assert.equal(controller.list.selectedIndex, 0)
})

test("j key appends to search query", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("j")
  assert.equal(controller.list.searchQuery, "j")
  assert.equal(controller.list.selectedIndex, 0)
})

test("k key appends to search query", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.list.selectedIndex = 1
  controller.handleInput("k")
  assert.equal(controller.list.searchQuery, "k")
  assert.equal(controller.list.selectedIndex, 0)
})

test("selection clamped to last item", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.list.selectedIndex = 2
  controller.handleInput("\x1b[B")
  assert.equal(controller.list.selectedIndex, 2)
})

// --- Selection ---

test("enter calls onSwitch callback with selected worktree", () => {
  let switchedWt: WorktreeSummary | undefined
  const { controller } = createController((wt) => {
    switchedWt = wt
  })
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("\r")
  assert.equal(switchedWt?.path, "/repo")
})

test("enter on second worktree calls onSwitch with correct worktree", () => {
  let switchedWt: WorktreeSummary | undefined
  const { controller } = createController((wt) => {
    switchedWt = wt
  })
  controller.open(sampleWorktrees, "/repo")
  controller.handleInput("\x1b[B") // down
  controller.handleInput("\r")
  assert.equal(switchedWt?.path, "/repo-feature")
})

// --- Escape / q ---

test("escape closes the picker", () => {
  const h = createController()
  h.controller.open(sampleWorktrees, "/repo")
  h.controller.handleInput("\x1b")
  assert.equal(h.closed, true)
  assert.equal(h.controller.state, "closed")
})

test("q and Q belong to the worktree search field", () => {
  const h = createController()
  h.controller.open(sampleWorktrees, "/repo")
  h.controller.handleInput("q")
  h.controller.handleInput("Q")
  assert.equal(h.closed, false)
  assert.equal(h.controller.list.searchQuery, "qQ")
})

// --- Loading state ---

test("handleInput ignores input during loading state", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.state = "loading"
  controller.handleInput("test")
  assert.equal(controller.list.searchQuery, "")
})

// --- Ref label helpers ---

test("refLabel returns branch name when branch exists", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const label = controller.refLabel({ path: "/repo", branch: "main", head: "abc123" })
  assert.equal(label, "main")
})

test("refLabel returns detached HEAD when detached", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const label = controller.refLabel({ path: "/repo", head: "abc123", detached: true })
  assert.equal(label, "detached abc123")
})

test("refLabel returns bare when bare", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const label = controller.refLabel({ path: "/repo", head: "abc123", bare: true })
  assert.equal(label, "bare")
})

test("refLabel returns head hash when no branch or detached", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const label = controller.refLabel({ path: "/repo", head: "abc123" })
  assert.equal(label, "abc123")
})

test("refLabel returns HEAD when no head provided", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const label = controller.refLabel({ path: "/repo" })
  assert.equal(label, "HEAD")
})

// --- Rendering ---

test("renderOverlayLines returns lines array", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  assert.ok(Array.isArray(lines))
  assert.ok(lines.length > 0)
})

test("renderOverlayLines includes title", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Worktrees"))
  assert.ok(titleLine)
})

test("renderOverlayLines shows search line", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const searchLine = lines.find((line) => line.includes("Search:"))
  assert.ok(searchLine)
})

test("renderOverlayLines shows loading message", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  controller.state = "loading"
  controller.loadingMessage = "Loading worktrees…"
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const loadingLine = lines.find((line) => line.includes("Loading worktrees"))
  assert.ok(loadingLine)
})

test("renderOverlayLines shows current marker for active path", () => {
  const { controller } = createController()
  controller.open(sampleWorktrees, "/repo")
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const currentLine = lines.find((line) => line.includes("current"))
  assert.ok(currentLine)
})
