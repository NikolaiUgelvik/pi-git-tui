// Command menu overlay controller.
// Uses FilterableListState<GitCommand> for search/navigation/scroll.
// Rendering is pure; side effects (running git commands) go through callbacks.
import { FilterableListState } from "./filterable-list-state.js";
import { createOverlayFrame, renderSearchOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js";
import { GIT_COMMANDS } from "./types.js";
// --- Controller ---
export class CommandMenuController {
    callbacks;
    list;
    state = "closed";
    loadingMessage;
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.list = new FilterableListState(GIT_COMMANDS, (cmd) => `${cmd.label} ${cmd.description} git ${cmd.args.join(" ")}`);
    }
    // --- Lifecycle ---
    open() {
        this.state = "open";
        this.list.reset();
        this.list.clampSelection();
        this.callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.callbacks.onClose();
        this.callbacks.onRequestRender();
    }
    isOpen() {
        return this.state !== "closed";
    }
    // --- Input handling ---
    handleInput(data) {
        if (this.state === "loading") {
            return;
        }
        if (isEscapeInput(data)) {
            this.close();
            return;
        }
        handleFilterableListInput(data, this.list, (command) => this.callbacks.onRunCommand(command));
        this.list.clampSelection();
        this.callbacks.onRequestRender();
    }
    // --- Rendering (pure) ---
    /**
     * Render the overlay lines. The caller merges them onto the base lines.
     * This matches the existing rendering behavior exactly.
     */
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        return renderSearchOverlayFrame(frame, theme, "Command menu", "type search • backspace edit • ↑↓ navigate • enter run • ? help • esc cancel", this.renderSearchLine(theme), this.renderBodyRows(frame.maxItems, theme));
    }
    renderSearchLine(theme) {
        const query = this.list.searchQuery.length > 0 ? `${this.list.searchQuery}▌` : theme.fg("muted", "type to filter commands");
        const countLabel = this.list.searchQuery.trim().length > 0
            ? ` ${theme.fg("muted", `(${this.list.filteredCount}/${GIT_COMMANDS.length})`)}`
            : "";
        return ` Search: ${query}${countLabel}`;
    }
    renderBodyRows(maxItems, theme) {
        if (this.state === "loading") {
            return [` ${theme.fg("warning", this.loadingMessage ?? "Running…")}`];
        }
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            return [` ${theme.fg("muted", "No matching commands")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return items.map(({ item, index }) => this.renderCommandRow(item, index, theme));
    }
    renderCommandRow(command, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const line = ` ${marker} ${theme.fg("accent", command.label)} ${theme.fg("muted", command.description)}`;
        return selected ? theme.bg("selectedBg", line) : line;
    }
}
//# sourceMappingURL=command-menu-controller.js.map