// Stash picker overlay controller.
// Uses FilterableListState<StashItem> for search/navigation/scroll.
// Rendering is pure; side effects (stashing, applying, popping, dropping) go through callbacks.
import { matchesKey } from "@earendil-works/pi-tui";
import { confirmationBodyLines, confirmationDecision, confirmationHint, } from "./confirmation-prompt.js";
import { FilterableListState } from "./filterable-list-state.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js";
// --- Controller ---
export class StashPickerController {
    list;
    state = "closed";
    loadingMessage;
    warning;
    stashConfirmAction;
    stashConfirmItem;
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
    get stashConfirmRef() {
        return this.stashConfirmItem?.ref ?? "";
    }
    clearStashConfirmation() {
        this.stashConfirmAction = undefined;
        this.stashConfirmItem = undefined;
    }
    // --- Lifecycle ---
    open(stashes) {
        this.state = "open";
        this.warning = undefined;
        this._rawStashes = stashes;
        this.rebuildItems();
        this.list.reset();
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    refreshStashes(stashes) {
        this.warning = undefined;
        this._rawStashes = stashes;
        this.rebuildItems();
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    showListWarning(message) {
        this.warning = message;
        this.state = "open";
        this._callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.warning = undefined;
        this.clearStashConfirmation();
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
        if (this.state === "confirm") {
            this.handleConfirmInput(data);
            this._callbacks.onRequestRender();
            return;
        }
        if (isEscapeInput(data)) {
            this.close();
            return;
        }
        if (this.state === "loading") {
            return;
        }
        if (this.warning && data === "r") {
            this._callbacks.onRetryList();
            this._callbacks.onRequestRender();
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
        this.stashConfirmItem = item.stash;
        this.state = "confirm";
        return true;
    }
    handleConfirmInput(data) {
        const decision = confirmationDecision(data);
        if (decision === "cancel") {
            this.state = "open";
            return;
        }
        if (decision !== "confirm") {
            return;
        }
        const ref = this.stashConfirmRef;
        const action = this.stashConfirmAction;
        if (action === "pop") {
            this._callbacks.onPop(ref);
        }
        else if (action === "drop") {
            this._callbacks.onDrop(ref);
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
        const frame = createOverlayFrame(baseLineCount, width, theme);
        const title = this.stashTitle(theme);
        const hint = this.stashHint(theme, frame.compact);
        return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold(title))}`, ` ${theme.fg("dim", hint)}`, this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.bodyRows, frame.compact, theme));
    }
    stashTitle(_theme) {
        return this.state === "confirm" ? this.stashConfirmationPrompt().title : "Stashes";
    }
    stashHint(_theme, compact) {
        if (this.state === "confirm") {
            return confirmationHint(this.stashConfirmationPrompt());
        }
        return compact
            ? "Enter apply • Ctrl+P pop • Ctrl+D drop • Esc"
            : "enter stash/apply • Ctrl+P pop • Ctrl+D drop • F1 help • esc cancel";
    }
    renderBodyRows(maxItems, innerWidth, bodyRows, compact, theme) {
        if (this.state === "loading") {
            return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`];
        }
        if (this.state === "confirm") {
            return confirmationBodyLines(this.stashConfirmationPrompt(), theme, {
                compact,
                maxRows: bodyRows,
                width: innerWidth,
            });
        }
        const warning = this.warning ? [` ${theme.fg("warning", this.warning)} • r retry list`] : [];
        const spacing = compact ? [] : [""];
        const itemRows = Math.max(0, maxItems - warning.length);
        return [this.renderSearchLine(innerWidth, theme), ...spacing, ...warning, ...this.renderStashItems(itemRows, theme)];
    }
    stashConfirmationPrompt() {
        const stash = this.stashConfirmItem;
        const details = [`Stash: ${stash?.ref ?? "selected stash"}`, `Message: ${stash?.message ?? ""}`];
        if (this.stashConfirmAction === "pop") {
            return {
                title: "Pop stash?",
                details,
                consequence: "Applies changes and removes the stash only after a successful application. Conflicts may modify the working tree.",
                confirmLabel: "Pop stash",
            };
        }
        return {
            title: "Drop stash?",
            details,
            consequence: "Permanently deletes this stash. This cannot be undone.",
            confirmLabel: "Drop stash",
        };
    }
    renderSearchLine(innerWidth, theme) {
        const prefix = " Search: ";
        const field = this.list.searchField.render(Math.max(1, innerWidth - prefix.length), this.list.searchField.focused, theme.fg("muted", "type to filter stashes"));
        return `${prefix}${field}`;
    }
    renderStashItems(maxItems, theme) {
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching stashes")}`];
        }
        if (maxItems <= 0) {
            return [];
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