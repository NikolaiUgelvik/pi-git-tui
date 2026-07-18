// Branch picker overlay controller.
// Uses FilterableListState<BranchSummary> for search/navigation/scroll.
// Rendering is pure; side effects (switching/creating branches) go through callbacks.
import { matchesKey } from "@earendil-works/pi-tui";
import { FilterableListState, isBackspace, isEnter, isPrintableInput } from "./filterable-list-state.js";
import { createOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isCancelInput } from "./overlay-input.js";
// --- Controller ---
export class BranchPickerController {
    list;
    state = "closed";
    loadingMessage;
    branchCreateName = "";
    _callbacks;
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.list = new FilterableListState([], (branch) => `${branch.name} ${branch.upstream ?? ""}`);
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
        if (this.state === "loading") {
            return;
        }
        if (this.state === "create") {
            this.updateCreateInput(data);
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
        if (isBackspace(data)) {
            this.branchCreateName = [...this.branchCreateName].slice(0, -1).join("");
            return;
        }
        if (isEnter(data)) {
            this.submitCreateInput();
            return;
        }
        if (isCancelInput(data)) {
            this.state = "open";
            return;
        }
        if (isPrintableInput(data)) {
            this.branchCreateName += data;
        }
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
        const { maxItems, row, border } = createOverlayFrame(baseLineCount, width, theme);
        const lines = [
            border("top"),
            row(` ${theme.fg("accent", theme.bold("Branches"))}`),
            row(` ${theme.fg("dim", "type search • Ctrl+N new • enter switch/create • ? help • esc cancel")}`),
            ...this.renderBodyRows(maxItems, theme),
            row(""),
            border("bottom"),
        ];
        return lines;
    }
    renderBodyRows(maxItems, theme) {
        if (this.state === "loading") {
            return [rowEmpty(), rowContent(` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`)];
        }
        if (this.state === "create") {
            const placeholder = this.branchCreateName || theme.fg("muted", "branch-name");
            return [rowEmpty(), rowContent(` New branch: ${placeholder}▌`)];
        }
        return [rowContent(this.renderSearchLine(theme)), rowEmpty(), ...this.renderBranchItems(maxItems, theme)];
    }
    renderSearchLine(theme) {
        const query = this.list.searchQuery.length > 0 ? `${this.list.searchQuery}▌` : theme.fg("muted", "type to filter branches");
        return ` Search: ${query}`;
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