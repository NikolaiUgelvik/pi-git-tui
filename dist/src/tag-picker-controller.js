import { matchesKey } from "@earendil-works/pi-tui";
import { FilterableListState, isEnter } from "./filterable-list-state.js";
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js";
import { handleFilterableListInput, isEscapeInput, resetFilterableList } from "./overlay-input.js";
import { SingleLineTextField } from "./single-line-text-field.js";
export class TagPickerController {
    callbacks;
    list;
    commits;
    state = "closed";
    loadingMessage;
    createTarget;
    createAnnotated = false;
    nameField = new SingleLineTextField();
    messageField = new SingleLineTextField();
    createFocus = "name";
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.list = new FilterableListState([], (tag) => [
            tag.name,
            tag.annotated ? "annotated" : "lightweight",
            tag.targetHash,
            tag.targetType,
            tag.createdAt,
            tag.creator,
            tag.annotation,
            tag.targetSubject,
        ]
            .filter(Boolean)
            .join(" "));
        this.commits = new FilterableListState([], (commit) => `${commit.hash} ${commit.message}`);
    }
    get createName() {
        return this.nameField.value;
    }
    set createName(value) {
        this.nameField.setValue(value, "end");
    }
    get createMessage() {
        return this.messageField.value;
    }
    set createMessage(value) {
        this.messageField.setValue(value, "end");
    }
    activeTextField() {
        if (this.state === "open")
            return this.list.searchField;
        if (this.state === "target")
            return this.commits.searchField;
        if (this.state === "create")
            return this.createFocus === "message" ? this.messageField : this.nameField;
    }
    open(tags) {
        this.state = "open";
        this.list.items = tags;
        this.clearCreation();
        resetFilterableList(this.list, this.callbacks.onRequestRender);
    }
    openTargetSelection(commits) {
        this.state = "target";
        this.commits.items = commits;
        resetFilterableList(this.commits, this.callbacks.onRequestRender);
    }
    refreshTags(tags) {
        this.list.items = tags;
        this.list.clampSelection();
        this.callbacks.onRequestRender();
    }
    showTagList() {
        this.state = "open";
        this.list.searchQuery = "";
        this.list.reset();
        this.clearCreation();
        this.callbacks.onRequestRender();
    }
    close() {
        this.state = "closed";
        this.loadingMessage = undefined;
        this.clearCreation();
        this.callbacks.onClose();
        this.callbacks.onRequestRender();
    }
    handleInput(data) {
        if (this.state === "loading" || this.state === "closed")
            return;
        if (isEscapeInput(data)) {
            this.handleEscape();
            return;
        }
        if (this.state === "create") {
            this.handleCreateInput(data);
        }
        else if (this.state === "target") {
            handleFilterableListInput(data, this.commits, (commit) => this.beginCreate(commit));
            this.commits.clampSelection();
        }
        else if (this.isCreateShortcut(data)) {
            this.callbacks.onRequestTargets();
        }
        else {
            handleFilterableListInput(data, this.list, this.callbacks.onSelect);
            this.list.clampSelection();
        }
        this.callbacks.onRequestRender();
    }
    handleEscape() {
        if (this.state === "create") {
            this.state = "target";
            this.callbacks.onRequestRender();
            return;
        }
        if (this.state === "target") {
            this.state = "open";
            this.callbacks.onRequestRender();
            return;
        }
        this.close();
    }
    isCreateShortcut(data) {
        return matchesKey(data, "ctrl+n") || data === "\x0e";
    }
    beginCreate(target) {
        this.createTarget = target;
        this.createAnnotated = false;
        this.createName = "";
        this.createMessage = "";
        this.createFocus = "name";
        this.state = "create";
    }
    handleCreateInput(data) {
        if (matchesKey(data, "ctrl+t") || data === "\x14") {
            this.createAnnotated = !this.createAnnotated;
            if (!this.createAnnotated)
                this.createFocus = "name";
            return;
        }
        if (matchesKey(data, "tab") || data === "\t") {
            if (this.createAnnotated)
                this.createFocus = this.createFocus === "name" ? "message" : "name";
            return;
        }
        if (isEnter(data)) {
            this.submitCreation();
            return;
        }
        const field = this.createFocus === "message" ? this.messageField : this.nameField;
        field.handleInput(data, "editor");
    }
    submitCreation() {
        const name = this.createName.trim();
        const message = this.createMessage.trim();
        if (!name) {
            this.callbacks.onValidationError("Tag name is empty");
            return;
        }
        if (this.createAnnotated && !message) {
            this.callbacks.onValidationError("Annotated tag message is empty");
            return;
        }
        const target = this.createTarget;
        if (!target) {
            this.callbacks.onValidationError("Select a target commit");
            return;
        }
        this.callbacks.onCreate({
            name,
            target,
            annotated: this.createAnnotated,
            message: this.createAnnotated ? message : undefined,
        });
    }
    clearCreation() {
        this.createTarget = undefined;
        this.createName = "";
        this.createMessage = "";
        this.createAnnotated = false;
        this.createFocus = "name";
    }
    renderOverlayLines(baseLineCount, width, theme) {
        const frame = createOverlayFrame(baseLineCount, width, theme);
        return renderOverlayFrame(frame, ` ${theme.fg("accent", theme.bold(this.title()))}`, ` ${theme.fg("dim", this.hint(frame.compact))}`, this.renderBody(frame.maxItems, frame.innerWidth, frame.compact, theme));
    }
    title() {
        if (this.state === "target")
            return "Select tag target";
        if (this.state === "create")
            return `Create tag at ${this.createTarget?.hash ?? "commit"}`;
        return "Tags";
    }
    hint(compact) {
        if (this.state === "loading")
            return "Esc cancel";
        if (this.state === "target")
            return compact ? "↑↓ move • Enter target • Esc back" : "type search • enter target • F1 help • esc back";
        if (this.state === "create") {
            return compact
                ? "Tab field • Ctrl+T type • Enter create"
                : "Tab switch field • Ctrl+T toggle type • enter create • F1 help • esc back";
        }
        return compact ? "↑↓ move • Enter view • Ctrl+N new" : "type search • enter view • Ctrl+N new • F1 help • esc close";
    }
    renderBody(maxItems, innerWidth, compact, theme) {
        if (this.state === "loading")
            return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`];
        if (this.state === "create")
            return this.renderCreateRows(innerWidth, compact, theme);
        const search = this.state === "target" ? this.commits : this.list;
        const noun = this.state === "target" ? "commits" : "tags";
        const prefix = " Search: ";
        const field = search.searchField.render(Math.max(1, innerWidth - prefix.length), search.searchField.focused, theme.fg("muted", `type to filter ${noun}`));
        const spacing = compact ? [] : [""];
        const rows = this.state === "target" ? this.renderCommitRows(maxItems, theme) : this.renderTagRows(maxItems, theme);
        return [`${prefix}${field}`, ...spacing, ...rows];
    }
    renderTagRows(maxItems, theme) {
        this.list.clampSelection();
        if (this.list.filteredCount === 0) {
            const message = this.list.searchQuery ? "No matching tags" : "No tags yet — Ctrl+N creates one";
            return [` ${theme.fg("muted", message)}`];
        }
        return this.list.visibleItems(maxItems).map(({ item, index }) => {
            const selected = index === this.list.selectedIndex;
            const marker = selected ? "▶" : " ";
            const kind = item.annotated ? "annotated" : "lightweight";
            const targetType = item.targetType === "commit" ? "" : ` ${item.targetType}`;
            const metadata = [kind, `${item.targetHash}${targetType}`, item.createdAt, item.creator]
                .filter(Boolean)
                .join(" • ");
            const description = [item.annotation, item.targetSubject].filter(Boolean).join(" • ");
            const suffix = description ? ` — ${description}` : "";
            const line = ` ${marker} ${theme.fg("accent", item.name)} ${theme.fg("muted", metadata)}${suffix}`;
            return selected ? theme.bg("selectedBg", line) : line;
        });
    }
    renderCommitRows(maxItems, theme) {
        this.commits.clampSelection();
        if (this.commits.filteredCount === 0)
            return [` ${theme.fg("muted", "No commits available")}`];
        return this.commits.visibleItems(maxItems).map(({ item, index }) => {
            const selected = index === this.commits.selectedIndex;
            const marker = selected ? "▶" : " ";
            const line = ` ${marker} ${theme.fg("accent", item.hash)} ${item.message}`;
            return selected ? theme.bg("selectedBg", line) : line;
        });
    }
    renderCreateRows(innerWidth, compact, theme) {
        const target = this.createTarget;
        const targetRow = ` Target: ${theme.fg("accent", target?.hash ?? "none")} ${target?.message ?? ""}`;
        const namePrefix = this.createFocus === "name" ? "▶ Name: " : "  Name: ";
        const name = this.nameField.render(Math.max(1, innerWidth - namePrefix.length), this.nameField.focused, theme.fg("muted", "tag-name"));
        const typeRow = `  Type: ${theme.fg("accent", this.createAnnotated ? "annotated" : "lightweight")} ${theme.fg("muted", "(Ctrl+T toggles)")}`;
        const rows = [`${namePrefix}${name}`, typeRow];
        if (this.createAnnotated) {
            const messagePrefix = this.createFocus === "message" ? "▶ Message: " : "  Message: ";
            const message = this.messageField.render(Math.max(1, innerWidth - messagePrefix.length), this.messageField.focused, theme.fg("muted", "tag annotation"));
            rows.push(`${messagePrefix}${message}`);
        }
        return compact ? [...rows, targetRow] : [targetRow, "", ...rows];
    }
}
//# sourceMappingURL=tag-picker-controller.js.map