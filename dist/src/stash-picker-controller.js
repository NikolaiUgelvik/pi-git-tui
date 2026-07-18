// Stash picker overlay controller.
// Uses FilterableListState<StashItem> for search/navigation/scroll.
// Rendering is pure; side effects (stashing, applying, popping, dropping) go through callbacks.
import { matchesKey } from "@earendil-works/pi-tui";
import { FilterableListState, isEnter } from "./filterable-list-state.js";
import { createOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isCancelInput } from "./overlay-input.js";
// --- Controller ---
export class StashPickerController {
    list;
    state = "closed";
    loadingMessage;
    stashConfirmAction;
    stashConfirmRef = "";
    _callbacks;
    _rawStashes = [];
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.list = new FilterableListState([], (item) => {
            if (item.type === "stash-current") {
                return "stash current changes includes untracked";
            }
            return `${item.stash?.ref ?? ""} ${item.stash?.message ?? ""}`;
        });
    }
    // --- Lifecycle ---
    open(stashes) {
        this.state = "open";
        this._rawStashes = stashes;
        this.rebuildItems();
        this.list.reset();
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    refreshStashes(stashes) {
        this._rawStashes = stashes;
        this.rebuildItems();
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.stashConfirmAction = undefined;
        this.stashConfirmRef = "";
        this._callbacks.onClose();
        this._callbacks.onRequestRender();
    }
    isOpen() {
        return this.state !== "closed";
    }
    rebuildItems() {
        const stashItems = this._rawStashes.map((stash) => ({ type: "stash-item", stash }));
        this.list.items = [{ type: "stash-current" }, ...stashItems];
    }
    // --- Input handling ---
    handleInput(data) {
        if (this.state === "loading") {
            return;
        }
        if (this.state === "confirm") {
            this.handleConfirmInput(data);
            this._callbacks.onRequestRender();
            return;
        }
        if (isCancelInput(data)) {
            this.close();
            return;
        }
        this.updatePickerInput(data);
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    updatePickerInput(data) {
        if (this.handlePop(data) || this.handleDrop(data)) {
            return;
        }
        handleFilterableListInput(data, this.list, (item) => this.handleSelection(item));
    }
    handlePop(data) {
        if (!matchesKey(data, "ctrl+p") && data !== "\x10") {
            return false;
        }
        return this.openConfirm("pop");
    }
    handleDrop(data) {
        if (!matchesKey(data, "ctrl+d") && data !== "\x04") {
            return false;
        }
        return this.openConfirm("drop");
    }
    openConfirm(action) {
        const item = this.list.get(this.list.selectedIndex);
        if (item?.type !== "stash-item" || !item.stash) {
            return true;
        }
        this.stashConfirmAction = action;
        this.stashConfirmRef = item.stash.ref;
        this.state = "confirm";
        return true;
    }
    handleConfirmInput(data) {
        if (isCancelInput(data)) {
            this.state = "open";
        }
        else if (isEnter(data)) {
            const ref = this.stashConfirmRef;
            const action = this.stashConfirmAction;
            if (action === "pop") {
                this._callbacks.onPop(ref);
            }
            else if (action === "drop") {
                this._callbacks.onDrop(ref);
            }
        }
    }
    handleSelection(item) {
        if (item.type === "stash-current") {
            this._callbacks.onStashCurrent();
            return;
        }
        if (item.stash) {
            this._callbacks.onApply(item.stash.ref);
        }
    }
    // --- Rendering (pure) ---
    renderOverlayLines(baseLineCount, width, theme) {
        const { maxItems, row, border } = createOverlayFrame(baseLineCount, width, theme);
        const title = this.stashTitle(theme);
        const hint = this.stashHint(theme);
        const lines = [
            border("top"),
            row(` ${theme.fg("accent", theme.bold(title))}`),
            row(` ${theme.fg("dim", hint)}`),
            ...this.renderBodyRows(maxItems, theme),
            row(""),
            border("bottom"),
        ];
        return lines;
    }
    stashTitle(_theme) {
        if (this.state === "confirm") {
            return this.stashConfirmAction === "pop" ? "Pop stash?" : "Drop stash?";
        }
        return "Stashes";
    }
    stashHint(_theme) {
        return "enter stash/apply • Ctrl+P pop • Ctrl+D drop • ? help • esc cancel";
    }
    renderBodyRows(maxItems, theme) {
        if (this.state === "loading") {
            return ["", ` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`];
        }
        if (this.state === "confirm") {
            return ["", ` ${this.stashTitle(theme)} ${this.stashConfirmRef}`, theme.fg("warning", " Enter OK • Esc/q Cancel")];
        }
        return [this.renderSearchLine(theme), "", ...this.renderStashItems(maxItems, theme)];
    }
    renderSearchLine(theme) {
        const query = this.list.searchQuery.length > 0 ? `${this.list.searchQuery}▌` : theme.fg("muted", "type to filter stashes");
        return ` Search: ${query}`;
    }
    renderStashItems(maxItems, theme) {
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching stashes")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return items.map(({ item, index }) => this.renderStashRow(item, index, theme));
    }
    renderStashRow(item, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const line = this.stashRowLine(item, marker, theme);
        return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`;
    }
    stashRowLine(item, marker, theme) {
        if (item.type === "stash-current") {
            return `${marker} ${theme.fg("accent", "stash current changes")} ${theme.fg("muted", "includes untracked")}`;
        }
        const stash = item.stash;
        return `${marker} ${theme.fg("accent", stash?.ref ?? "stash")} ${stash?.message ?? ""}`;
    }
}
//# sourceMappingURL=stash-picker-controller.js.map