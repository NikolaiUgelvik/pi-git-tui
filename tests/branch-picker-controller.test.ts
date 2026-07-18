import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { BranchPickerController } from "../src/branch-picker-controller.js"
import type { BranchSummary } from "../src/types.js"

// --- Test harness ---

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const sampleBranches: BranchSummary[] = [
  { name: "main", current: true },
  { name: "develop", current: false, upstream: "origin/develop", track: "ahead 2" },
  { name: "feature/test", current: false, upstream: "origin/feature/test" },
]

function createController(
  switchSpy?: (name: string) => void,
  createSpy?: (name: string) => void,
  validationSpy?: (message: string) => void,
) {
  let closed = false
  let renderCalled = false
  const controller = new BranchPickerController({
    onSwitch: (name: string) => {
      if (switchSpy) switchSpy(name)
    },
    onCreate: (name: string) => {
      if (createSpy) createSpy(name)
    },
    onValidationError: (message: string) => {
      if (validationSpy) validationSpy(message)
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
  controller.open(sampleBranches)
  assert.equal(controller.state, "open")
  assert.equal(controller.isOpen(), true)
})

test("opening the picker initializes list with branches", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  assert.equal(controller.list.items.length, 3)
})

test("opening the picker resets list state", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  assert.equal(controller.list.searchQuery, "")
  assert.equal(controller.list.selectedIndex, 0)
  assert.equal(controller.list.scroll, 0)
})

test("opening the picker requests render", () => {
  const h = createController()
  h.controller.open(sampleBranches)
  assert.equal(h.renderCalled, true)
})

// --- Closing the picker ---

test("closing the picker sets state to closed", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.close()
  assert.equal(controller.state, "closed")
  assert.equal(controller.isOpen(), false)
})

test("closing the picker calls onClose callback", () => {
  const h = createController()
  h.controller.open(sampleBranches)
  h.controller.close()
  assert.equal(h.closed, true)
})

// --- Search ---

test("search filters branches by name", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("feat")
  assert.equal(controller.list.filteredCount, 1)
})

test("printable punctuation belongs to branch search", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("?*q")
  assert.equal(controller.list.searchQuery, "?*q")
})

test("backspace removes last search character", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("feat")
  controller.handleInput("\b")
  assert.equal(controller.list.searchQuery, "fea")
})

test("search with no matches shows zero filtered count", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("nonexistent")
  assert.equal(controller.list.filteredCount, 0)
})

// --- Navigation ---

test("up arrow moves selection up", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.list.selectedIndex = 1
  controller.handleInput("\x1b[A") // up arrow
  assert.equal(controller.list.selectedIndex, 0)
})

test("down arrow moves selection down", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x1b[B") // down arrow
  assert.equal(controller.list.selectedIndex, 1)
})

test("j key appends to search query", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("j")
  assert.equal(controller.list.searchQuery, "j")
  assert.equal(controller.list.selectedIndex, 0)
})

test("k key appends to search query", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.list.selectedIndex = 1
  controller.handleInput("k")
  assert.equal(controller.list.searchQuery, "k")
  assert.equal(controller.list.selectedIndex, 0)
})

test("selection clamped to last item", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.list.selectedIndex = 2
  controller.handleInput("\x1b[B") // down arrow
  assert.equal(controller.list.selectedIndex, 2)
})

// --- Selection ---

test("enter on branch calls onSwitch callback", () => {
  let switchedTo = ""
  const { controller } = createController((name) => {
    switchedTo = name
  })
  controller.open(sampleBranches)
  controller.handleInput("\r")
  assert.equal(switchedTo, "main")
})

test("enter on second branch calls onSwitch with correct name", () => {
  let switchedTo = ""
  const { controller } = createController((name) => {
    switchedTo = name
  })
  controller.open(sampleBranches)
  controller.handleInput("\x1b[B") // down
  controller.handleInput("\r")
  assert.equal(switchedTo, "develop")
})

// --- Escape ---

test("escape closes the picker", () => {
  const h = createController()
  h.controller.open(sampleBranches)
  h.controller.handleInput("\x1b") // escape
  assert.equal(h.closed, true)
  assert.equal(h.controller.state, "closed")
})

test("q belongs to the branch search field", () => {
  const h = createController()
  h.controller.open(sampleBranches)
  h.controller.handleInput("q")
  assert.equal(h.closed, false)
  assert.equal(h.controller.list.searchQuery, "q")
})

// --- Create mode ---

test("Ctrl+N opens create mode", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x0e") // Ctrl+N
  assert.equal(controller.state, "create")
  assert.equal(controller.branchCreateName, "")
})

test("typing in create mode builds branch name", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x0e") // Ctrl+N
  controller.handleInput("f")
  controller.handleInput("e")
  controller.handleInput("a")
  assert.equal(controller.branchCreateName, "fea")
})

test("backspace in create mode removes last character", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x0e")
  controller.handleInput("fea")
  controller.handleInput("\b")
  assert.equal(controller.branchCreateName, "fe")
})

test("enter in create mode calls onCreate callback", () => {
  let createdName = ""
  const { controller } = createController(undefined, (name) => {
    createdName = name
  })
  controller.open(sampleBranches)
  controller.handleInput("\x0e")
  controller.handleInput("new-branch")
  controller.handleInput("\r")
  assert.equal(createdName, "new-branch")
})

test("empty enter in create mode reports validation error", () => {
  let createdName = ""
  let validationMessage = ""
  const { controller } = createController(
    undefined,
    (name) => {
      createdName = name
    },
    (message) => {
      validationMessage = message
    },
  )
  controller.open(sampleBranches)
  controller.handleInput("\x0e")
  controller.handleInput("\r")
  assert.equal(createdName, "")
  assert.equal(validationMessage, "Branch name is empty")
})

test("escape in create mode returns to open state", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x0e")
  controller.handleInput("new-branch")
  controller.handleInput("\x1b")
  assert.equal(controller.state, "open")
})

test("q in create mode is part of the branch name", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.handleInput("\x0e")
  controller.handleInput("new-branch")
  controller.handleInput("q")
  assert.equal(controller.state, "create")
  assert.equal(controller.branchCreateName, "new-branchq")
})

// --- Loading state ---

test("handleInput ignores input during loading state", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.state = "loading"
  controller.handleInput("feat")
  assert.equal(controller.list.searchQuery, "")
})

// --- Rendering ---

test("renderOverlayLines returns lines array", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  assert.ok(Array.isArray(lines))
  assert.ok(lines.length > 0)
})

test("renderOverlayLines includes title", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Branches"))
  assert.ok(titleLine)
})

test("renderOverlayLines shows search line", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const searchLine = lines.find((line) => line.includes("Search:"))
  assert.ok(searchLine)
})

test("renderOverlayLines shows loading message", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.state = "loading"
  controller.loadingMessage = "Loading branches…"
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const loadingLine = lines.find((line) => line.includes("Loading branches"))
  assert.ok(loadingLine)
})

test("renderOverlayLines shows create mode input", () => {
  const { controller } = createController()
  controller.open(sampleBranches)
  controller.state = "create"
  controller.branchCreateName = "my-branch"
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const createLine = lines.find((line) => line.includes("New branch:"))
  assert.ok(createLine)
})
