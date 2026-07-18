// Branch picker overlay controller.
// Uses FilterableListState<BranchSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching/creating branches) go through callbacks.
import { matchesKey } from "@earendil-works/pi-tui";
import { FilterableListState, isEnter } from "./filterable-list-state.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js";
import { SingleLineTextField } from "./single-line-text-field.js";
// --- Controller ---
export class BranchPickerController {
    list;
    state = "closed";
    loadingMessage;
    branchCreateField = new SingleLineTextField();
    _callbacks;
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.list = new FilterableListState([], (branch) => `${branch.name} ${branch.upstream ?? ""}`);
    }
    get branchCreateName() {
        return this.branchCreateField.value;
    }
    set branchCreateName(value) {
        this.branchCreateField.setValue(value, "end");
    }
    activeTextField() {
        if (this.state === "create") {
            return this.branchCreateField;
        }
        return this.state === "open" ? this.list.searchField : undefined;
    }
    // --- Lifecycle ---
    open(branches) {
        this.state = "open";
        this.list.items = branches;
        this.list.reset();
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.branchCreateName = "";
        this._callbacks.onClose();
        this._callbacks.onRequestRender();
    }
    isOpen() {
        return this.state !== "closed";
    }
    // --- Input handling ---
    handleInput(data) {
        if (isEscapeInput(data)) {
            if (this.state === "create") {
                this.state = "open";
                this._callbacks.onRequestRender();
            }
            else {
                this.close();
            }
            return;
        }
        if (this.state === "loading") {
            return;
        }
        if (this.state === "create") {
            this.updateCreateInput(data);
            this._callbacks.onRequestRender();
            return;
        }
        this.updatePickerInput(data);
        this.list.clampSelection();
        this._callbacks.onRequestRender();
    }
    updatePickerInput(data) {
        if (this.openCreateMode(data)) {
            return;
        }
        handleFilterableListInput(data, this.list, (branch) => this._callbacks.onSwitch(branch.name));
    }
    openCreateMode(data) {
        if (!matchesKey(data, "ctrl+n") && data !== "\x0e") {
            return false;
        }
        this.branchCreateName = "";
        this.state = "create";
        return true;
    }
    updateCreateInput(data) {
        if (isEnter(data)) {
            this.submitCreateInput();
            return;
        }
        this.branchCreateField.handleInput(data, "editor");
    }
    submitCreateInput() {
        const name = this.branchCreateName.trim();
        if (name) {
            this._callbacks.onCreate(name);
            return;
        }
        this._callbacks.onValidationError("Branch name is empty");
    }
    // --- Rendering (pure) ---
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * Matches the existing branch picker rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        const hint = frame.compact
            ? "↑↓ move • Enter select • Ctrl+N new • Esc"
            : "type search • Ctrl+N new • enter switch/create • F1 help • esc cancel";
        return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold("Branches"))}`, ` ${theme.fg("dim", hint)}`, this.renderBodyRows(frame.maxItems, frame.innerWidth, frame.compact, theme));
    }
    renderBodyRows(maxItems, innerWidth, compact, theme) {
        if (this.state === "loading") {
            return [rowContent(` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`)];
        }
        if (this.state === "create") {
            const prefix = " New branch: ";
            const field = this.branchCreateField.render(Math.max(1, innerWidth - prefix.length), this.branchCreateField.focused, theme.fg("muted", "branch-name"));
            return [rowContent(`${prefix}${field}`)];
        }
        const spacing = compact ? [] : [rowEmpty()];
        return [
            rowContent(this.renderSearchLine(innerWidth, theme)),
            ...spacing,
            ...this.renderBranchItems(maxItems, theme),
        ];
    }
    renderSearchLine(innerWidth, theme) {
        const prefix = " Search: ";
        const field = this.list.searchField.render(Math.max(1, innerWidth - prefix.length), this.list.searchField.focused, theme.fg("muted", "type to filter branches"));
        return `${prefix}${field}`;
    }
    renderBranchItems(maxItems, theme) {
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching branches")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return items.map(({ item, index }) => this.renderBranchRow(item, index, theme));
    }
    renderBranchRow(branch, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const current = branch.current ? theme.fg("success", " current") : "";
        const upstream = branch.upstream
            ? `${theme.fg("muted", ` ${branch.upstream}`)}${branch.track ? theme.fg("muted", ` ${branch.track}`) : ""}`
            : "";
        const line = `${marker} ${theme.fg("accent", branch.name)}${current}${upstream}`;
        return selected ? theme.bg("selectedBg", ` ${line}`) : ` ${line}`;
    }
}
function rowEmpty() {
    return "";
}
function rowContent(content) {
    return content;
}
//# sourceMappingURL=branch-picker-controller.js.map