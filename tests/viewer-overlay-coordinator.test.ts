import assert from "node:assert/strict"
import { test } from "node:test"
import { ViewerOverlayCoordinator } from "../src/viewer-overlay-coordinator.js"

test("the highest-priority active overlay owns input, help, rendering, and lifecycle", () => {
  const coordinator = new ViewerOverlayCoordinator()
  const input: string[] = []
  let confirmationOpen = true
  let stashOpen = true

  coordinator.register("confirmation", {
    isActive: () => confirmationOpen,
    activeTextField: () => undefined,
    helpContext: () => "confirmDialog",
    render: () => ["confirmation"],
    handleInput: (data) => input.push(`confirmation:${data}`),
    handleOpen: () => false,
    close: () => {
      confirmationOpen = false
    },
  })
  coordinator.register("stash", {
    isActive: () => stashOpen,
    activeTextField: () => undefined,
    helpContext: () => "stashPicker",
    render: () => ["stash"],
    handleInput: (data) => input.push(`stash:${data}`),
    handleOpen: () => false,
    close: () => {
      stashOpen = false
    },
  })

  assert.equal(coordinator.active()?.kind, "stash")
  assert.equal(coordinator.helpContext(), "stashPicker")
  assert.deepEqual(coordinator.render(["base"], 20), ["stash"])
  assert.equal(coordinator.handleInput("x"), true)
  assert.deepEqual(input, ["stash:x"])

  assert.equal(coordinator.closeActive(), true)
  assert.equal(coordinator.active()?.kind, "confirmation")
  assert.equal(coordinator.helpContext(), "confirmDialog")
})
