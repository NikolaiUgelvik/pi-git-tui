// Worktree picker overlay controller.
// Uses FilterableListState<WorktreeSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching worktrees) go through callbacks.
import { FilterableListState } from "./filterable-list-state.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListControllerInput, resetFilterableList } from "./overlay-input.js";
// --- Controller ---
export class WorktreePickerController {
    list;
    state = "closed";
    loadingMessage;
    activePath = "";
    _callbacks;
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.list = new FilterableListState([], (worktree) => this.searchText(worktree));
    }
    // --- Lifecycle ---
    open(worktrees, activePath) {
        this.state = "open";
        this.activePath = activePath;
        this.list.items = worktrees;
        resetFilterableList(this.list, this._callbacks.onRequestRender);
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
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
            onEnter: (worktree) => this._callbacks.onSwitch(worktree),
            onClose: () => this.close(),
            onRequestRender: this._callbacks.onRequestRender,
        });
    }
    // --- Search helpers ---
    searchText(worktree) {
        const refLabel = this.refLabel(worktree);
        return `${worktree.path} ${refLabel} ${worktree.head ?? ""}`;
    }
    refLabel(worktree) {
        if (worktree.branch) {
            return worktree.branch;
        }
        if (worktree.detached) {
            return `detached ${worktree.head ?? "HEAD"}`;
        }
        if (worktree.bare) {
            return "bare";
        }
        return worktree.head ?? "HEAD";
    }
    // --- Rendering (pure) ---
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        const hint = frame.compact
            ? "↑↓ move • Enter select • Esc close • F1"
            : "type search • ↑↓ navigate • enter select • F1 help • esc cancel";
        return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold("Worktrees"))}`, ` ${theme.fg("dim", hint)}`, this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.compact, theme));
    }
    renderBodyRows(maxItems, innerWidth, compact, theme) {
        if (this.state === "loading") {
            return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`];
        }
        return [
            this.renderSearchLine(innerWidth, theme),
            ...(compact ? [] : [""]),
            ...this.renderWorktreeItems(maxItems, theme),
        ];
    }
    renderSearchLine(innerWidth, theme) {
        const prefix = " Search: ";
        const field = this.list.searchField.render(Math.max(1, innerWidth - prefix.length), this.list.searchField.focused, theme.fg("muted", "type to filter worktrees"));
        return `${prefix}${field}`;
    }
    renderWorktreeItems(maxItems, theme) {
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching worktrees")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return items.map(({ item, index }) => this.renderWorktreeRow(item, index, theme));
    }
    renderWorktreeRow(worktree, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const current = worktree.path === this.activePath ? theme.fg("success", " current") : "";
        const line = `${marker} ${theme.fg("accent", worktree.path)} ${theme.fg("muted", this.refLabel(worktree))}${current}`;
        return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`;
    }
}
//# sourceMappingURL=worktree-picker-controller.js.map