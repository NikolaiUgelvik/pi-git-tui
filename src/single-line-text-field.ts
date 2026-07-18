import { type Focusable, Input, type KeyId, matchesKey } from "@earendil-works/pi-tui"
import { fit } from "./render-text.js"

export type TextFieldRouting = "search" | "editor"
export type TextFieldCaret = "start" | "end"

function isEnter(data: string): boolean {
  return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n"
}

function isF1(data: string): boolean {
  return matchesKey(data, "f1") || data === "\x1bOP"
}

const SEARCH_RESERVED_KEYS: KeyId[] = ["escape", "up", "down", "pageUp", "pageDown", "home", "end"]
const EDITOR_RESERVED_KEYS: KeyId[] = ["escape", "ctrl+x", "ctrl+g"]
const EDITOR_RESERVED_BYTES = new Set(["\x18", "\x07"])

function isSearchReserved(data: string): boolean {
  return isEnter(data) || isF1(data) || SEARCH_RESERVED_KEYS.some((key) => matchesKey(data, key))
}

function isEditorReserved(data: string): boolean {
  return (
    isEnter(data) ||
    isF1(data) ||
    EDITOR_RESERVED_BYTES.has(data) ||
    EDITOR_RESERVED_KEYS.some((key) => matchesKey(data, key))
  )
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, " ").replace(/\t/gu, "    ")
}

/**
 * Focus-aware single-line editor built on pi-tui's grapheme-aware Input.
 * Routing policy stays here so printable keys are never mistaken for viewer
 * shortcuts while an editor owns focus.
 */
export class SingleLineTextField implements Focusable {
  private readonly input = new Input()

  constructor(
    value = "",
    private readonly placeholder = "",
  ) {
    this.setValue(value, "end")
  }

  get focused(): boolean {
    return this.input.focused
  }

  set focused(value: boolean) {
    this.input.focused = value
  }

  get value(): string {
    return this.input.getValue()
  }

  set value(value: string) {
    this.setValue(value, "end")
  }

  setValue(value: string, caret: TextFieldCaret = "end"): void {
    this.input.setValue(normalizeSingleLine(value))
    this.input.handleInput(caret === "start" ? "\x01" : "\x05")
  }

  handleInput(data: string, routing: TextFieldRouting): boolean {
    const reserved = routing === "search" ? isSearchReserved(data) : isEditorReserved(data)
    if (reserved) {
      return false
    }
    this.input.handleInput(data)
    return true
  }

  render(width: number, focused = this.focused, placeholder = this.placeholder): string {
    if (width <= 0) {
      return ""
    }
    this.focused = focused
    if (!this.value && !focused && placeholder) {
      return fit(placeholder, width)
    }
    const line = this.input.render(width + 2)[0] ?? ""
    return line.startsWith("> ") ? line.slice(2) : fit(line, width)
  }

  invalidate(): void {
    this.input.invalidate()
  }
}
