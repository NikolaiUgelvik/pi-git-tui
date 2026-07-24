import assert from "node:assert/strict"
import { test } from "node:test"
import { PickerSession } from "../src/picker-session.js"

test("loading captures return state and only the current request can finish", () => {
  const session = new PickerSession<"open" | "edit">()
  const first = session.beginLoading("First…", "closed")
  const second = session.beginLoading("Second…", "open")

  assert.equal(session.isCurrent(first), false)
  assert.equal(session.finish(first, "edit"), false)
  assert.equal(session.state, "loading")
  assert.equal(session.finish(second, "edit"), true)
  assert.equal(session.state, "edit")
  assert.equal(session.loadingMessage, undefined)
})

test("cancelling restores the captured state and invalidates completion", () => {
  const session = new PickerSession<"open">()
  const request = session.beginLoading("Loading…", "open")

  assert.equal(session.cancelLoading(), "open")
  assert.equal(session.isCurrent(request), false)
  assert.equal(session.finish(request, "closed"), false)
  assert.equal(session.state, "open")
})

test("transition clears loading text", () => {
  const session = new PickerSession<"open">()
  session.beginLoading("Loading…", "closed")

  session.transition("open")

  assert.equal(session.state, "open")
  assert.equal(session.loadingMessage, undefined)
})

test("loading messages can only be updated while loading", () => {
  const session = new PickerSession<"open">()
  session.updateLoadingMessage("Ignored")
  assert.equal(session.loadingMessage, undefined)

  session.beginLoading("Loading…", "open")
  session.updateLoadingMessage("Cancelling…")
  assert.equal(session.loadingMessage, "Cancelling…")

  session.finish({ generation: 1 }, "open")
  session.updateLoadingMessage("Also ignored")
  assert.equal(session.loadingMessage, undefined)
})

test("closing always invalidates work and reports whether it was loading", () => {
  const session = new PickerSession<"open">()
  const request = session.beginLoading("Loading…", "closed")
  session.updateLoadingMessage("Cancelling…")
  assert.equal(session.loadingMessage, "Cancelling…")

  assert.deepEqual(session.close(), { wasLoading: true })
  assert.equal(session.isCurrent(request), false)
  assert.equal(session.state, "closed")
  assert.deepEqual(session.close(), { wasLoading: false })
})
