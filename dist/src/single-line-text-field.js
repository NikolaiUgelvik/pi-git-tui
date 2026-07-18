import { Input, matchesKey } from "@earendil-works/pi-tui";
import { fit } from "./render-text.js";
function isEnter(data) {
    return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n";
}
function isF1(data) {
    return matchesKey(data, "f1") || data === "\x1bOP";
}
const SEARCH_RESERVED_KEYS = ["escape", "up", "down", "pageUp", "pageDown", "home", "end"];
const EDITOR_RESERVED_KEYS = ["escape", "ctrl+x", "ctrl+g"];
const EDITOR_RESERVED_BYTES = new Set(["\x18", "\x07"]);
function isSearchReserved(data) {
    return isEnter(data) || isF1(data) || SEARCH_RESERVED_KEYS.some((key) => matchesKey(data, key));
}
function isEditorReserved(data) {
    return (isEnter(data) ||
        isF1(data) ||
        EDITOR_RESERVED_BYTES.has(data) ||
        EDITOR_RESERVED_KEYS.some((key) => matchesKey(data, key)));
}
function normalizeSingleLine(value) {
    return value.replace(/\r\n|\r|\n/gu, " ").replace(/\t/gu, "    ");
}
/**
 * Focus-aware single-line editor built on pi-tui's grapheme-aware Input.
 * Routing policy stays here so printable keys are never mistaken for viewer
 * shortcuts while an editor owns focus.
 */
export class SingleLineTextField {
    placeholder;
    input = new Input();
    constructor(value = "", placeholder = "") {
        this.placeholder = placeholder;
        this.setValue(value, "end");
    }
    get focused() {
        return this.input.focused;
    }
    set focused(value) {
        this.input.focused = value;
    }
    get value() {
        return this.input.getValue();
    }
    set value(value) {
        this.setValue(value, "end");
    }
    setValue(value, caret = "end") {
        this.input.setValue(normalizeSingleLine(value));
        this.input.handleInput(caret === "start" ? "\x01" : "\x05");
    }
    handleInput(data, routing) {
        const reserved = routing === "search" ? isSearchReserved(data) : isEditorReserved(data);
        if (reserved) {
            return false;
        }
        this.input.handleInput(data);
        return true;
    }
    render(width, focused = this.focused, placeholder = this.placeholder) {
        if (width <= 0) {
            return "";
        }
        this.focused = focused;
        if (!this.value && !focused && placeholder) {
            return fit(placeholder, width);
        }
        const line = this.input.render(width + 2)[0] ?? "";
        return line.startsWith("> ") ? line.slice(2) : fit(line, width);
    }
    invalidate() {
        this.input.invalidate();
    }
}
//# sourceMappingURL=single-line-text-field.js.map