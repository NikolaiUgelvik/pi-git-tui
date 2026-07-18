import { matchesKey } from "@earendil-works/pi-tui";
import { SingleLineTextField } from "./single-line-text-field.js";
// --- Search utilities ---
/**
 * Split a search query into individual tokens.
 * Trims whitespace, lowercases, and splits on one or more whitespace characters.
 */
export function searchTokens(query) {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}
/**
 * Check whether all search tokens appear in the haystack (case-insensitive).
 * Returns true for an empty token list.
 */
export function matchesSearch(haystack, tokens) {
    const lower = haystack.toLowerCase();
    return tokens.every((token) => lower.includes(token));
}
// --- Navigation ---
/**
 * Compute the next selection index given a key event.
 * Returns undefined if the key is not a navigation key.
 */
export function nextListSelectionIndex(data, selectedIndex, itemCount) {
    const lastIndex = Math.max(0, itemCount - 1);
    if (matchesKey(data, "up") || data === "k" || data === "K") {
        return Math.max(0, selectedIndex - 1);
    }
    if (matchesKey(data, "down") || data === "j" || data === "J") {
        return Math.min(lastIndex, selectedIndex + 1);
    }
    return nextListSelectionPageIndex(data, selectedIndex, lastIndex);
}
/**
 * Page-level selection navigation (PageUp, PageDown, Home, End).
 * Returns undefined if the key is not a page navigation key.
 */
function nextListSelectionPageIndex(data, selectedIndex, lastIndex) {
    if (isPageUp(data)) {
        return Math.max(0, selectedIndex - 10);
    }
    if (isPageDown(data)) {
        return Math.min(lastIndex, selectedIndex + 10);
    }
    if (matchesKey(data, "home")) {
        return 0;
    }
    if (matchesKey(data, "end")) {
        return lastIndex;
    }
}
// --- Scroll calculation ---
/**
 * Compute the next scroll offset to keep the selected item visible.
 * Attempts to center the selection within the viewport, but will move the
 * scroll boundary if the selection is out of view.
 */
export function nextListScroll(selectedIndex, currentScroll, itemCount, maxItems) {
    const maxScroll = Math.max(0, itemCount - maxItems);
    const centeredScroll = Math.max(0, selectedIndex - Math.floor(maxItems / 2));
    let scroll = Math.max(0, Math.min(currentScroll, maxScroll, centeredScroll));
    if (selectedIndex < scroll) {
        scroll = selectedIndex;
    }
    if (selectedIndex >= scroll + maxItems) {
        scroll = selectedIndex - maxItems + 1;
    }
    return scroll;
}
// --- Key detection ---
/**
 * Check whether the input is a printable character (no escape sequences, code point >= 32).
 */
export function isPrintableInput(data) {
    if (data.length === 0 || data.includes("\x1b")) {
        return false;
    }
    return [...data].every((char) => {
        const codePoint = char.codePointAt(0);
        return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
}
/**
 * Check whether the input represents an Enter/Return key.
 */
export function isEnter(data) {
    return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n";
}
/**
 * Check whether the input represents a backspace key.
 */
export function isBackspace(data) {
    return matchesKey(data, "backspace") || data === "\b" || data === "\x7f";
}
/**
 * Check whether the input represents a PageUp key.
 */
function isPageUp(data) {
    return matchesKey(data, "pageUp") || data === "\x1b[5~";
}
/**
 * Check whether the input represents a PageDown key.
 */
function isPageDown(data) {
    return matchesKey(data, "pageDown") || data === "\x1b[6~";
}
function immutableItems(items) {
    return Object.freeze([...items]);
}
export class FilterableListState {
    searchText;
    searchField = new SingleLineTextField();
    selectedIndex = 0;
    scroll = 0;
    itemsSnapshot;
    itemsVersion = 0;
    filteredSnapshot;
    filteredSnapshotBuilds = 0;
    constructor(items, searchText) {
        this.searchText = searchText;
        this.itemsSnapshot = immutableItems(items);
    }
    get items() {
        return this.itemsSnapshot;
    }
    set items(items) {
        this.itemsSnapshot = immutableItems(items);
        this.itemsVersion++;
        this.filteredSnapshot = undefined;
    }
    get searchQuery() {
        return this.searchField.value;
    }
    set searchQuery(value) {
        if (value === this.searchField.value)
            return;
        this.searchField.setValue(value, "end");
        this.filteredSnapshot = undefined;
    }
    get filteredItems() {
        const query = this.searchQuery;
        const cached = this.filteredSnapshot;
        if (cached?.itemsVersion === this.itemsVersion && cached.query === query)
            return cached.items;
        const tokens = searchTokens(query);
        const items = tokens.length === 0
            ? this.itemsSnapshot
            : Object.freeze(this.itemsSnapshot.filter((item) => matchesSearch(this.searchText(item), tokens)));
        this.filteredSnapshot = Object.freeze({ itemsVersion: this.itemsVersion, query, items });
        this.filteredSnapshotBuilds++;
        return items;
    }
    get filteredCount() {
        return this.filteredItems.length;
    }
    get(index) {
        return this.filteredItems[index];
    }
    cacheStats() {
        return { itemsVersion: this.itemsVersion, filteredSnapshotBuilds: this.filteredSnapshotBuilds };
    }
    reset() {
        this.selectedIndex = 0;
        this.scroll = 0;
    }
    clampSelection() {
        this.selectedIndex = Math.max(0, Math.min(Math.max(0, this.filteredCount - 1), this.selectedIndex));
    }
    handleSearchInput(data) {
        const before = this.searchQuery;
        const handled = this.searchField.handleInput(data, "search");
        if (this.searchQuery !== before) {
            this.filteredSnapshot = undefined;
            this.reset();
        }
        return handled;
    }
    appendSearchChar(char) {
        this.handleSearchInput(char);
    }
    backspaceSearch() {
        this.handleSearchInput("\x7f");
    }
    moveSelection(data) {
        const nextIndex = nextListSelectionIndex(data, this.selectedIndex, this.filteredCount);
        if (nextIndex === undefined)
            return false;
        this.selectedIndex = nextIndex;
        return true;
    }
    visibleItems(maxItems) {
        const filteredItems = this.filteredItems;
        this.scroll = nextListScroll(this.selectedIndex, this.scroll, filteredItems.length, maxItems);
        const end = Math.min(filteredItems.length, this.scroll + maxItems);
        const result = [];
        for (let index = this.scroll; index < end; index++) {
            const item = filteredItems[index];
            if (item !== undefined)
                result.push({ item, index });
        }
        return result;
    }
}
//# sourceMappingURL=filterable-list-state.js.map