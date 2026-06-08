import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { StashPickerController } from "../src/stash-picker-controller.js"
import type { StashSummary } from "../src/types.js"

// --- Test harness ---

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const sampleStashes: StashSummary[] = [
  { ref: "stash@{0}", message: "WIP: feature work" },
  { ref: "stash@{1}", message: "save before refactor" },
]

function createController(
  stashCurrentSpy?: () => void,
  applySpy?: (ref: string) => void,
  popSpy?: (ref: string) => void,
  dropSpy?: (ref: string) => void,
) {
  let closed = false
  let renderCalled = false
  const controller = new StashPickerController({
    onStashCurrent: async () => {
      if (stashCurrentSpy) stashCurrentSpy()
    },
    onApply: async (ref: string) => {
      if (applySpy) applySpy(ref)
    },
    onPop: async (ref: string) => {
      if (popSpy) popSpy(ref)
    },
    onDrop: async (ref: string) => {
      if (dropSpy) dropSpy(ref)
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
  controller.open(sampleStashes)
  assert.equal(controller.state, "open")
  assert.equal(controller.isOpen(), true)
})

test("opening the picker adds stash-current as first item", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  const firstItem = controller.list.get(0)
  assert.equal(firstItem?.type, "stash-current")
})

test("opening the picker initializes list with stash items", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  // stash-current + 2 stashes
  assert.equal(controller.list.items.length, 3)
})

test("opening the picker resets list state", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  assert.equal(controller.list.searchQuery, "")
  assert.equal(controller.list.selectedIndex, 0)
  assert.equal(controller.list.scroll, 0)
})

test("opening the picker requests render", () => {
  const h = createController()
  h.controller.open(sampleStashes)
  assert.equal(h.renderCalled, true)
})

// --- Closing the picker ---

test("closing the picker sets state to closed", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.close()
  assert.equal(controller.state, "closed")
  assert.equal(controller.isOpen(), false)
})

test("closing the picker calls onClose callback", () => {
  const h = createController()
  h.controller.open(sampleStashes)
  h.controller.close()
  assert.equal(h.closed, true)
})

// --- Search ---

test("search filters stashes by message", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("refactor")
  assert.equal(controller.list.filteredCount, 1)
})

test("backspace removes last search character", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("refactor")
  controller.handleInput("\b")
  assert.equal(controller.list.searchQuery, "refacto")
})

// --- Navigation ---

test("down arrow moves selection down", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B")
  assert.equal(controller.list.selectedIndex, 1)
})

test("up arrow moves selection up", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.list.selectedIndex = 1
  controller.handleInput("\x1b[A")
  assert.equal(controller.list.selectedIndex, 0)
})

test("selection clamped to last item", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.list.selectedIndex = 2
  controller.handleInput("\x1b[B")
  assert.equal(controller.list.selectedIndex, 2)
})

// --- Selection ---

test("enter on stash-current calls onStashCurrent", () => {
  let stashCurrentCalled = false
  const { controller } = createController(() => {
    stashCurrentCalled = true
  })
  controller.open(sampleStashes)
  controller.handleInput("\r")
  assert.equal(stashCurrentCalled, true)
})

test("enter on stash item calls onApply", () => {
  let appliedRef = ""
  const { controller } = createController(undefined, (ref) => {
    appliedRef = ref
  })
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B") // move to first stash item (index 1)
  controller.handleInput("\r")
  assert.equal(appliedRef, "stash@{0}")
})

// --- Pop / Drop confirm ---

test("Ctrl+P opens pop confirm mode", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B") // move to stash item
  controller.handleInput("\x10") // Ctrl+P
  assert.equal(controller.state, "confirm")
  assert.equal(controller.stashConfirmAction, "pop")
})

test("Ctrl+D opens drop confirm mode", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B") // move to stash item
  controller.handleInput("\x04") // Ctrl+D
  assert.equal(controller.state, "confirm")
  assert.equal(controller.stashConfirmAction, "drop")
})

test("enter in confirm mode calls onPop", () => {
  let poppedRef = ""
  const { controller } = createController(undefined, undefined, (ref) => {
    poppedRef = ref
  })
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B") // move to stash item
  controller.handleInput("\x10") // Ctrl+P
  controller.handleInput("\r")
  assert.equal(poppedRef, "stash@{0}")
})

test("enter in confirm mode calls onDrop", () => {
  let droppedRef = ""
  const { controller } = createController(undefined, undefined, undefined, (ref) => {
    droppedRef = ref
  })
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B") // move to stash item
  controller.handleInput("\x04") // Ctrl+D
  controller.handleInput("\r")
  assert.equal(droppedRef, "stash@{0}")
})

test("escape in confirm mode returns to open state", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B")
  controller.handleInput("\x10") // Ctrl+P
  controller.handleInput("\x1b")
  assert.equal(controller.state, "open")
})

test("q in confirm mode returns to open state", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B")
  controller.handleInput("\x10")
  controller.handleInput("q")
  assert.equal(controller.state, "open")
})

// --- Escape / q ---

test("escape closes the picker", () => {
  const h = createController()
  h.controller.open(sampleStashes)
  h.controller.handleInput("\x1b")
  assert.equal(h.closed, true)
  assert.equal(h.controller.state, "closed")
})

test("q key closes the picker", () => {
  const h = createController()
  h.controller.open(sampleStashes)
  h.controller.handleInput("q")
  assert.equal(h.closed, true)
})

// --- Loading state ---

test("handleInput ignores input during loading state", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.state = "loading"
  controller.handleInput("test")
  assert.equal(controller.list.searchQuery, "")
})

// --- Refresh stashes ---

test("refreshStashes updates the list", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  const newStashes: StashSummary[] = [{ ref: "stash@{0}", message: "new stash" }]
  controller.refreshStashes(newStashes)
  // stash-current + 1 stash
  assert.equal(controller.list.items.length, 2)
})

// --- Rendering ---

test("renderOverlayLines returns lines array", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  assert.ok(Array.isArray(lines))
  assert.ok(lines.length > 0)
})

test("renderOverlayLines includes title", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Stashes"))
  assert.ok(titleLine)
})

test("renderOverlayLines shows confirm title for pop", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B")
  controller.handleInput("\x10") // Ctrl+P
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Pop stash?"))
  assert.ok(titleLine)
})

test("renderOverlayLines shows confirm title for drop", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.handleInput("\x1b[B")
  controller.handleInput("\x04") // Ctrl+D
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Drop stash?"))
  assert.ok(titleLine)
})

test("renderOverlayLines shows loading message", () => {
  const { controller } = createController()
  controller.open(sampleStashes)
  controller.state = "loading"
  controller.loadingMessage = "Loading stashes…"
  const lines = controller.renderOverlayLines(20, 100, mockTheme)
  const loadingLine = lines.find((line) => line.includes("Loading stashes"))
  assert.ok(loadingLine)
})
