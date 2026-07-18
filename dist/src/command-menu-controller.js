// Command menu overlay controller.
// Uses FilterableListState<GitCommand> for search/navigation/scroll.
// Rendering is pure; side effects (previewing/running commands) go through callbacks.
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { confirmationBodyLines, confirmationDecision, confirmationHint, } from "./confirmation-prompt.js";
import { FilterableListState } from "./filterable-list-state.js";
import { createOverlayFrame, renderOverlayFrame, renderSearchOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isEscapeInput } from "./overlay-input.js";
import { GIT_COMMANDS } from "./types.js";
export class CommandMenuController {
    callbacks;
    list;
    state = "closed";
    loadingMessage;
    previewError;
    pendingCommand;
    forcePushPreview;
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.list = new FilterableListState(GIT_COMMANDS, (cmd) => `${cmd.label} ${cmd.description} git ${cmd.args.join(" ")}`);
    }
    open() {
        this.state = "open";
        this.previewError = undefined;
        this.clearPendingPreview();
        this.list.reset();
        this.list.clampSelection();
        this.callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.previewError = undefined;
        this.clearPendingPreview();
        this.callbacks.onClose();
        this.callbacks.onRequestRender();
    }
    isOpen() {
        return this.state !== "closed";
    }
    showForcePushConfirmation(command, preview) {
        this.pendingCommand = command;
        this.forcePushPreview = preview;
        this.loadingMessage = undefined;
        this.previewError = undefined;
        this.state = "confirm";
        this.callbacks.onRequestRender();
    }
    showPreviewFailure(message) {
        this.clearPendingPreview();
        this.loadingMessage = undefined;
        this.previewError = message;
        this.state = "open";
        this.callbacks.onRequestRender();
    }
    returnToMenu() {
        this.clearPendingPreview();
        this.loadingMessage = undefined;
        this.state = "open";
        this.callbacks.onRequestRender();
    }
    handleInput(data) {
        if (this.state === "loading") {
            return;
        }
        if (this.state === "confirm") {
            this.handleConfirmationInput(data);
            this.callbacks.onRequestRender();
            return;
        }
        if (isEscapeInput(data)) {
            this.close();
            return;
        }
        handleFilterableListInput(data, this.list, (command) => this.selectCommand(command));
        this.list.clampSelection();
        this.callbacks.onRequestRender();
    }
    selectCommand(command) {
        this.previewError = undefined;
        this.pendingCommand = command;
        this.state = "loading";
        if (command.risk.kind === "force-push") {
            this.loadingMessage = "Resolving force-push destination…";
            this.callbacks.onPreviewForcePush(command);
            return;
        }
        this.loadingMessage = `Running ${command.label}…`;
        this.callbacks.onRunCommand(command);
    }
    handleConfirmationInput(data) {
        const decision = confirmationDecision(data);
        if (decision === "cancel") {
            this.returnToMenu();
            return;
        }
        if (decision !== "confirm" || !this.pendingCommand) {
            return;
        }
        const command = this.pendingCommand;
        this.state = "loading";
        this.loadingMessage = `Running ${command.label}…`;
        this.callbacks.onRunCommand(command);
    }
    clearPendingPreview() {
        this.pendingCommand = undefined;
        this.forcePushPreview = undefined;
    }
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        if (this.state === "confirm") {
            return this.renderForcePushConfirmation(frame, theme);
        }
        return renderSearchOverlayFrame(frame, theme, "Command menu", frame.compact
            ? "↑↓ move • Enter run • Esc close • F1"
            : "type search • backspace edit • ↑↓ navigate • enter run • F1 help • esc cancel", this.renderSearchLine(frame.innerWidth, theme), this.renderBodyRows(frame.maxItems, theme));
    }
    renderForcePushConfirmation(frame, theme) {
        const prompt = this.forcePushConfirmationPrompt();
        const hint = frame.compact ? "Enter: Push • Esc • F1" : confirmationHint(prompt);
        const body = frame.compact
            ? this.compactForcePushBody(frame.innerWidth, frame.bodyRows, theme)
            : confirmationBodyLines(prompt, theme, {
                maxRows: frame.bodyRows,
                width: frame.innerWidth,
            });
        return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold(prompt.title))}`, ` ${theme.fg("dim", hint)}`, body);
    }
    compactForcePushBody(width, maxRows, theme) {
        const preview = this.forcePushPreview;
        const destination = wrapTextWithAnsi(` To:${preview?.destination ?? "unresolved"}`, Math.max(1, width));
        const updates = preview?.updates.length
            ? preview.updates.flatMap((update) => wrapTextWithAnsi(` ${update.flag || " "} ${this.compactRef(update.source) || "(delete)"}→${this.compactRef(update.destination)}`, Math.max(1, width)))
            : [" Updates: no ref changes"];
        const warning = wrapTextWithAnsi(theme.fg("warning", " ⚠ Can overwrite remote"), Math.max(1, width));
        return [...destination, ...updates, ...warning].slice(0, maxRows);
    }
    compactRef(ref) {
        return ref.replace(/^refs\/(?:heads|tags)\//u, "");
    }
    forcePushConfirmationPrompt() {
        const preview = this.forcePushPreview;
        const updates = preview?.updates.length
            ? preview.updates.map((update) => `Update: ${update.source || "(delete)"} → ${update.destination} ${update.summary}`.trimEnd())
            : ["Updates: Git reported no ref changes"];
        return {
            title: "Confirm force push",
            details: [
                `Command: ${preview?.command ?? "git push --force-with-lease"}`,
                `Destination: ${preview?.destination ?? "unresolved"}`,
                ...updates,
            ],
            consequence: "This can overwrite remote commits. --force-with-lease rejects the push if the remote changed unexpectedly.",
            confirmLabel: "Force push",
        };
    }
    renderSearchLine(innerWidth, theme) {
        const prefix = " Search: ";
        const countLabel = this.list.searchQuery.trim().length > 0
            ? ` ${theme.fg("muted", `(${this.list.filteredCount}/${GIT_COMMANDS.length})`)}`
            : "";
        const fieldWidth = Math.max(1, innerWidth - visibleWidth(prefix) - visibleWidth(countLabel));
        const field = this.list.searchField.render(fieldWidth, this.list.searchField.focused, theme.fg("muted", "type to filter commands"));
        return `${prefix}${field}${countLabel}`;
    }
    renderBodyRows(maxItems, theme) {
        if (this.state === "loading") {
            return [` ${theme.fg("warning", this.loadingMessage ?? "Running…")}`];
        }
        this.list.clampSelection();
        const warning = this.previewError ? [` ${theme.fg("warning", this.previewError)}`, ""] : [];
        if (this.list.filteredCount === 0) {
            return [...warning, ` ${theme.fg("muted", "No matching commands")}`];
        }
        const items = this.list.visibleItems(maxItems);
        return [...warning, ...items.map(({ item, index }) => this.renderCommandRow(item, index, theme))];
    }
    renderCommandRow(command, index, theme) {
        const selected = index === this.list.selectedIndex;
        const marker = selected ? "▶" : " ";
        const risk = command.risk.kind === "force-push" ? theme.fg("warning", " preview required") : "";
        const line = ` ${marker} ${theme.fg("accent", command.label)} ${theme.fg("muted", command.description)}${risk}`;
        return selected ? theme.bg("selectedBg", line) : line;
    }
}
//# sourceMappingURL=command-menu-controller.js.map