// Commit picker overlay controller.
// Uses FilterableListState<CommitPickerItem> for search/navigation/scroll.
// Rendering is pure; side effects (loading diffs) go through callbacks.
import { visibleWidth } from "@earendil-works/pi-tui";
import { FilterableListState } from "./filterable-list-state.js";
import { createOverlayFrame, renderSearchOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListControllerInput, resetFilterableList } from "./overlay-input.js";
// --- Controller ---
export class CommitPickerController {
    list;
    state = "closed";
    loadingMessage;
    totalCommits = 0;
    _callbacks;
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.list = new FilterableListState([], (item) => {
            if (item.type === "working") {
                return "working tree staged unstaged";
            }
            return `${item.commit.hash} ${item.commit.message}`;
        });
    }
    // --- Lifecycle ---
    open(commits) {
        this.state = "open";
        this.totalCommits = commits.length;
        const workingItem = { type: "working" };
        const commitItems = commits.map((commit) => ({ type: "commit", commit }));
        this.list.items = [workingItem, ...commitItems];
        resetFilterableList(this.list, this._callbacks.onRequestRender);
    }
    close() {
        this.loadingMessage = undefined;
        this.state = "closed";
        this._callbacks.onClose();
        this._callbacks.onRequestRender();
    }
    isOpen() {
        return this.state === "open" || this.state === "loading";
    }
    // --- Input handling ---
    handleInput(data) {
        handleFilterableListControllerInput(data, {
            state: this.state,
            list: this.list,
            onEnter: (item) => this.handleSelection(item),
            onClose: () => this.close(),
            onRequestRender: this._callbacks.onRequestRender,
        });
    }
    handleSelection(item) {
        if (item.type === "working") {
            this._callbacks.onSelectWorkingTree();
            return;
        }
        this._callbacks.onSelectCommit(item.commit);
    }
    // --- Rendering (pure) ---
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * Matches the existing commit picker rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        return renderSearchOverlayFrame(frame, theme, "Select commit", frame.compact
            ? "↑↓ move • Enter select • Esc close • F1"
            : "type search • backspace edit • ↑↓ navigate • enter select • F1 help • esc cancel", this.renderSearchLine(frame.innerWidth, theme), this.renderBodyRows(frame.maxItems, theme));
    }
    renderSearchLine(innerWidth, theme) {
        const prefix = " Search: ";
        const matchCount = this.getFilteredCommitCount();
        const countLabel = this.list.searchQuery.trim().length > 0 ? ` ${theme.fg("muted", `(${matchCount}/${this.totalCommits})`)}` : "";
        const fieldWidth = Math.max(1, innerWidth - visibleWidth(prefix) - visibleWidth(countLabel));
        const field = this.list.searchField.render(fieldWidth, this.list.searchField.focused, theme.fg("muted", "type to filter commits"));
        return `${prefix}${field}${countLabel}`;
    }
    getFilteredCommitCount() {
        let count = 0;
        for (const item of this.list.filteredItems) {
            if (item.type === "commit")
                count++;
        }
        return count;
    }
    renderBodyRows(maxItems, theme) {
        if (this.state === "loading") {
            return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`];
        }
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching commits")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return items.map(({ item, index }) => this.renderItemRow(item, index, theme));
    }
    renderItemRow(item, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const line = item.type === "working"
            ? ` ${marker} ${theme.fg("accent", "working tree")} ${theme.fg("muted", "staged + unstaged")}`
            : ` ${marker} ${theme.fg("accent", item.commit.hash)} ${item.commit.message}`;
        return selected ? theme.bg("selectedBg", line) : line;
    }
}
//# sourceMappingURL=commit-picker-controller.js.map