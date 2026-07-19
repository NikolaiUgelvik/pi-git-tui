import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { CommandMenuController } from "../src/command-menu-controller.js"
import type { ForcePushPreview, GitCommand } from "../src/types.js"
import { GIT_COMMANDS } from "../src/types.js"

// --- Test harness ---

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

function createController(runCommandSpy?: (cmd: GitCommand) => void, previewForcePushSpy?: (cmd: GitCommand) => void) {
  let closed = false
  let renderCalled = false
  const callbacks = {
    onRunCommand: async (command: GitCommand) => {
      if (runCommandSpy) runCommandSpy(command)
    },
    onPreviewForcePush: (command: GitCommand) => {
      previewForcePushSpy?.(command)
    },
    onClose: () => {
      closed = true
    },
    onRequestRender: () => {
      renderCalled = true
    },
  }
  const controller = new CommandMenuController(callbacks)
  return {
    controller,
    callbacks,
    get closed() {
      return closed
    },
    get renderCalled() {
      return renderCalled
    },
  }
}

const forcePushCommand = GIT_COMMANDS.find((command) => command.risk.kind === "force-push")
assert.ok(forcePushCommand)

const forcePushPreview: ForcePushPreview = {
  command: "git push --force-with-lease",
  destination: "https://example.com/org/repo.git",
  updates: [
    {
      flag: "+",
      source: "refs/heads/main",
      destination: "refs/heads/main",
      summary: "abc123..def456 (forced update)",
    },
  ],
}

const addedCommandLabels = new Set([
  "Fetch + Prune",
  "Fetch All Remotes",
  "Pull (FF Only)",
  "Update Submodules",
  "Push Tags",
])

// --- Command catalog ---

test("command catalog includes the additions in related menu groups", () => {
  assert.deepEqual(
    GIT_COMMANDS.map((command) => command.label),
    [
      "Fetch",
      "Fetch + Prune",
      "Fetch All Remotes",
      "Pull (FF Only)",
      "Pull",
      "Pull (Rebase)",
      "Update Submodules",
      "Push",
      "Push Tags",
      "Force Push",
    ],
  )
  assert.deepEqual(
    GIT_COMMANDS.filter((command) => addedCommandLabels.has(command.label)).map((command) => ({
      label: command.label,
      args: command.args,
      risk: command.risk,
      refreshDiff: command.refreshDiff,
    })),
    [
      {
        label: "Fetch + Prune",
        args: ["fetch", "--prune"],
        risk: { kind: "normal" },
        refreshDiff: true,
      },
      {
        label: "Fetch All Remotes",
        args: ["fetch", "--all", "--prune"],
        risk: { kind: "normal" },
        refreshDiff: true,
      },
      {
        label: "Pull (FF Only)",
        args: ["pull", "--ff-only"],
        risk: { kind: "normal" },
        refreshDiff: true,
      },
      {
        label: "Update Submodules",
        args: ["submodule", "update", "--init", "--recursive"],
        risk: { kind: "normal" },
        refreshDiff: true,
      },
      {
        label: "Push Tags",
        args: ["push", "--tags"],
        risk: { kind: "normal" },
        refreshDiff: true,
      },
    ],
  )
})

// --- Opening the menu ---

test("opening the menu sets state to open", () => {
  const { controller } = createController()
  assert.equal(controller.state, "closed")
  controller.open()
  assert.equal(controller.state, "open")
  assert.equal(controller.isOpen(), true)
})

test("opening the menu resets list state", () => {
  const { controller } = createController()
  controller.open()
  assert.equal(controller.list.searchQuery, "")
  assert.equal(controller.list.selectedIndex, 0)
  assert.equal(controller.list.scroll, 0)
})

test("opening the menu requests render", () => {
  const h = createController()
  h.controller.open()
  assert.equal(h.renderCalled, true)
})

// --- Closing the menu ---

test("closing the menu sets state to closed", () => {
  const { controller } = createController()
  controller.open()
  controller.close()
  assert.equal(controller.state, "closed")
  assert.equal(controller.isOpen(), false)
})

test("closing the menu calls onClose callback", () => {
  const h = createController()
  h.controller.open()
  h.controller.close()
  assert.equal(h.closed, true)
})

test("closing the menu clears loading message", () => {
  const { controller } = createController()
  controller.loadingMessage = "Running…"
  controller.close()
  assert.equal(controller.loadingMessage, undefined)
})

// --- Search filtering ---

test("typing a character appends to search query", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("f")
  assert.equal(controller.list.searchQuery, "f")
})

test("printable q, ?, and * belong to command search", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("q?*")
  assert.equal(controller.list.searchQuery, "q?*")
  assert.equal(controller.state, "open")
})

test("typing multiple characters builds search query", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("p")
  controller.handleInput("u")
  controller.handleInput("s")
  assert.equal(controller.list.searchQuery, "pus")
})

test("backspace removes last character from search", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("p")
  controller.handleInput("u")
  controller.handleInput("s")
  controller.handleInput("\b") // backspace
  assert.equal(controller.list.searchQuery, "pu")
})

test("backspace on empty query keeps it empty", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\b") // backspace
  assert.equal(controller.list.searchQuery, "")
})

test("search filters items", () => {
  const { controller } = createController()
  controller.open()
  // No search - all items visible
  assert.equal(controller.list.filteredCount, GIT_COMMANDS.length)
  // Search for "push" - should match Push, Push Tags, and Force Push
  controller.handleInput("p")
  controller.handleInput("u")
  controller.handleInput("s")
  controller.handleInput("h")
  assert.equal(controller.list.filteredCount, 3)
})

// --- Navigation ---

test("down arrow moves selection down", () => {
  const { controller } = createController()
  controller.open()
  assert.equal(controller.list.selectedIndex, 0)
  controller.handleInput("\x1b[B") // down
  assert.equal(controller.list.selectedIndex, 1)
})

test("up arrow moves selection up", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[B") // down to 1
  assert.equal(controller.list.selectedIndex, 1)
  controller.handleInput("\x1b[A") // up to 0
  assert.equal(controller.list.selectedIndex, 0)
})

test("up arrow at top stays at 0", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[A") // up at 0
  assert.equal(controller.list.selectedIndex, 0)
})

test("down arrow at bottom stays at last", () => {
  const { controller } = createController()
  controller.open()
  // Go to the end
  const last = GIT_COMMANDS.length - 1
  controller.handleInput("\x1b[F") // end
  assert.equal(controller.list.selectedIndex, last)
  controller.handleInput("\x1b[B") // down at last
  assert.equal(controller.list.selectedIndex, last)
})

test("home key moves to first", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[B") // down to 1
  controller.handleInput("\x1b[H") // home
  assert.equal(controller.list.selectedIndex, 0)
})

test("end key moves to last", () => {
  const { controller } = createController()
  controller.open()
  const last = GIT_COMMANDS.length - 1
  controller.handleInput("\x1b[F") // end
  assert.equal(controller.list.selectedIndex, last)
})

test("page up moves selection up by 10", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[F") // end (index 9 for 10 items)
  controller.handleInput("\x1b[5~") // page up
  assert.equal(controller.list.selectedIndex, 0) // clamped at 0
})

test("page down moves selection down by 10", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[6~") // page down
  assert.equal(controller.list.selectedIndex, GIT_COMMANDS.length - 1) // clamped at last
})

// --- Selection ---

test("enter selects the current command", () => {
  let selectedCommand: GitCommand | undefined
  const { controller } = createController((cmd) => {
    selectedCommand = cmd
  })
  controller.open()
  controller.handleInput("\r") // enter
  assert.equal(selectedCommand?.label, GIT_COMMANDS[0].label)
})

test("enter after navigating selects the new command", () => {
  let selectedCommand: GitCommand | undefined
  const { controller } = createController((cmd) => {
    selectedCommand = cmd
  })
  controller.open()
  controller.handleInput("\x1b[B") // down to Fetch + Prune
  controller.handleInput("\r") // enter
  assert.equal(selectedCommand?.label, "Fetch + Prune")
})

test("Force Push previews on first Enter and repeated Enter cannot run it", () => {
  const runs: GitCommand[] = []
  const previews: GitCommand[] = []
  const { controller } = createController(
    (command) => runs.push(command),
    (command) => previews.push(command),
  )
  controller.open()
  controller.handleInput("\x1b[F")

  controller.handleInput("\r")
  controller.handleInput("\r")

  assert.deepEqual(previews, [forcePushCommand])
  assert.deepEqual(runs, [])
  assert.equal(controller.state, "loading")
})

test("force-push confirmation shows exact destination and command", () => {
  const { controller } = createController()
  controller.open()
  controller.showForcePushConfirmation(forcePushCommand, forcePushPreview)

  const frame = controller.renderOverlayLines(30, 120, mockTheme).join("\n")

  assert.match(frame, /git push --force-with-lease/u)
  assert.match(frame, /https:\/\/example\.com\/org\/repo\.git/u)
  assert.match(frame, /refs\/heads\/main → refs\/heads\/main/u)
  assert.match(frame, /Enter: Force push • Esc: Cancel/u)
})

test("compact force-push confirmation keeps destination and ref update visible", () => {
  const { controller } = createController()
  controller.open()
  controller.showForcePushConfirmation(forcePushCommand, forcePushPreview)

  const frame = controller.renderOverlayLines(8, 30, mockTheme)
  const compactText = frame.join("").replace(/[\s│╭╮╰╯─]/gu, "")

  assert.match(compactText, /https:\/\/example\.com\/org\/repo\.git/u)
  assert.match(compactText, /main→main/u)
  assert.match(frame.join("\n"), /Enter: Push/u)
  assert.match(frame.join("\n"), /Esc/u)
})

test("Escape from force-push confirmation preserves filter and selection", () => {
  const { controller } = createController()
  controller.open()
  controller.list.searchQuery = "push"
  controller.list.selectedIndex = 1
  controller.showForcePushConfirmation(forcePushCommand, forcePushPreview)

  controller.handleInput("\x1b")

  assert.equal(controller.state, "open")
  assert.equal(controller.list.searchQuery, "push")
  assert.equal(controller.list.selectedIndex, 1)
})

test("second Enter executes a confirmed force push exactly once", () => {
  const runs: GitCommand[] = []
  const { controller } = createController((command) => runs.push(command))
  controller.open()
  controller.showForcePushConfirmation(forcePushCommand, forcePushPreview)

  controller.handleInput("\r")
  controller.handleInput("\r")

  assert.deepEqual(runs, [forcePushCommand])
  assert.equal(controller.state, "loading")
})

// --- Escape closes the menu ---

test("escape closes the menu", () => {
  const h = createController()
  h.controller.open()
  assert.equal(h.controller.state, "open")
  h.controller.handleInput("\x1b") // escape
  assert.equal(h.controller.state, "closed")
  assert.equal(h.closed, true)
})

// --- Loading state blocks input ---

test("loading state ignores input", () => {
  const { controller } = createController()
  controller.open()
  controller.state = "loading"
  controller.handleInput("\x1b[B") // down
  assert.equal(controller.list.selectedIndex, 0) // didn't move
  controller.handleInput("\x1b[O") // escape
  assert.equal(controller.state, "loading") // didn't close
})

// --- Rendering ---

test("renderOverlayLines produces expected number of lines", () => {
  const { controller } = createController()
  controller.open()
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  // The 20-line overlay has room to render all 10 commands without scrolling.
  assert.equal(lines.length, 20)
})

test("renderOverlayLines includes title", () => {
  const { controller } = createController()
  controller.open()
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  const titleLine = lines.find((line) => line.includes("Command menu"))
  assert.ok(titleLine !== undefined)
})

test("renderOverlayLines shows all commands when no search", () => {
  const { controller } = createController()
  controller.open()
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  for (const command of GIT_COMMANDS) {
    assert.ok(
      lines.some((line) => line.includes(command.label)),
      `Missing ${command.label}`,
    )
  }
})

test("renderOverlayLines shows loading message", () => {
  const { controller } = createController()
  controller.state = "loading"
  controller.loadingMessage = "Running…"
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  assert.ok(lines.some((line) => line.includes("Running…")))
})

test("renderOverlayLines shows no matching commands", () => {
  const { controller } = createController()
  controller.open()
  // Search for something that won't match
  controller.list.searchQuery = "xyznonexistent"
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  assert.ok(lines.some((line) => line.includes("No matching commands")))
})

test("renderOverlayLines marks selected item", () => {
  const { controller } = createController()
  controller.open()
  controller.handleInput("\x1b[B") // down to index 1
  const lines = controller.renderOverlayLines(40, 100, mockTheme)
  const selectedLine = lines.find((line) => line.includes("▶"))
  assert.ok(selectedLine !== undefined)
})
