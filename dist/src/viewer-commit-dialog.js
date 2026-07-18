import { matchesKey } from "@earendil-works/pi-tui";
import { generateCommitMessage, loadWorkingTreeDiff, runGitCommit } from "./git.js";
import { DiffViewerCommitPicker } from "./viewer-commit-picker.js";
export class DiffViewerCommitDialog extends DiffViewerCommitPicker {
    openCommitDialog() {
        this.error = undefined;
        this.statusMessage = undefined;
        this.commitMessageCaret = this.commitMessageLength();
        this.commitDialogState = "open";
        this.requestRender();
    }
    handleCommitDialogInput(data) {
        if (this.commitDialogState === "loading" || this.closeCommitDialogOnEscape(data)) {
            return;
        }
        this.updateCommitDialogInput(data);
        this.requestRender();
    }
    closeCommitDialogOnEscape(data) {
        if (!matchesKey(data, "escape")) {
            return false;
        }
        this.commitDialogState = "closed";
        this.requestRender();
        return true;
    }
    updateCommitDialogInput(data) {
        const handlers = [
            () => this.handleCommitAmendToggle(data),
            () => this.handleCommitMessageGeneration(data),
            () => this.handleCommitMessageCaretMove(data),
            () => this.handleCommitMessageBackspace(data),
            () => this.handleCommitMessageDelete(data),
            () => this.handleCommitSubmission(data),
            () => this.handleCommitMessageText(data),
        ];
        for (const handler of handlers) {
            if (handler()) {
                return;
            }
        }
    }
    commitMessageChars() {
        return [...this.commitMessage];
    }
    commitMessageLength() {
        return this.commitMessageChars().length;
    }
    clampCommitMessageCaret(chars = this.commitMessageChars()) {
        this.commitMessageCaret = Math.max(0, Math.min(this.commitMessageCaret, chars.length));
        return this.commitMessageCaret;
    }
    setCommitMessageChars(chars) {
        this.commitMessage = chars.join("");
        this.clampCommitMessageCaret(chars);
    }
    handleCommitAmendToggle(data) {
        if (!matchesKey(data, "ctrl+x") && data !== "\x18") {
            return false;
        }
        this.commitAmend = !this.commitAmend;
        return true;
    }
    handleCommitMessageGeneration(data) {
        if (data !== "*") {
            return false;
        }
        this.generateCommitMessageIntoDialog().catch((error) => this.showAsyncError(error));
        return true;
    }
    handleCommitMessageCaretMove(data) {
        const chars = this.commitMessageChars();
        this.clampCommitMessageCaret(chars);
        if (matchesKey(data, "left")) {
            this.commitMessageCaret = Math.max(0, this.commitMessageCaret - 1);
            return true;
        }
        if (matchesKey(data, "right")) {
            this.commitMessageCaret = Math.min(chars.length, this.commitMessageCaret + 1);
            return true;
        }
        if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
            this.commitMessageCaret = 0;
            return true;
        }
        if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
            this.commitMessageCaret = chars.length;
            return true;
        }
        return false;
    }
    handleCommitMessageBackspace(data) {
        if (!this.isBackspace(data)) {
            return false;
        }
        const chars = this.commitMessageChars();
        const caret = this.clampCommitMessageCaret(chars);
        if (caret > 0) {
            chars.splice(caret - 1, 1);
            this.commitMessageCaret = caret - 1;
            this.setCommitMessageChars(chars);
        }
        return true;
    }
    handleCommitMessageDelete(data) {
        if (!matchesKey(data, "delete") && data !== "\x1b[3~") {
            return false;
        }
        const chars = this.commitMessageChars();
        const caret = this.clampCommitMessageCaret(chars);
        if (caret < chars.length) {
            chars.splice(caret, 1);
            this.setCommitMessageChars(chars);
        }
        return true;
    }
    handleCommitSubmission(data) {
        if (!this.isEnter(data)) {
            return false;
        }
        const message = this.commitMessage.trim();
        if (!message) {
            this.error = "Commit message is empty";
            this.statusMessage = undefined;
            return true;
        }
        this.commitStagedChanges(message).catch((error) => this.showAsyncError(error));
        return true;
    }
    handleCommitMessageText(data) {
        if (!this.isPrintableInput(data)) {
            return false;
        }
        const chars = this.commitMessageChars();
        const input = [...data];
        const caret = this.clampCommitMessageCaret(chars);
        chars.splice(caret, 0, ...input);
        this.commitMessageCaret = caret + input.length;
        this.setCommitMessageChars(chars);
        return true;
    }
    async generateCommitMessageIntoDialog() {
        const cwd = this.activePath();
        let disposition;
        this.commitDialogState = "loading";
        this.loadingMessage = "Generating commit message…";
        this.error = undefined;
        this.statusMessage = undefined;
        this.requestRender();
        try {
            disposition = await this.operationCoordinator.applyLatest(`commit-message:${cwd}`, (signal) => generateCommitMessage(this.pi, this.contextFor(cwd, signal)), (message) => {
                this.commitMessage = message;
                this.commitMessageCaret = this.commitMessageLength();
            });
        }
        catch (error) {
            this.setAsyncError(error);
        }
        finally {
            if (disposition !== "superseded") {
                this.commitDialogState = "open";
                this.loadingMessage = undefined;
                this.requestRender();
            }
        }
    }
    async commitStagedChanges(message) {
        await this.runMutation("commit", async (signal) => {
            const cwd = this.activePath();
            let disposition;
            this.commitDialogState = "loading";
            this.loadingMessage = "Committing staged changes…";
            this.error = undefined;
            this.statusMessage = undefined;
            this.requestRender();
            try {
                const output = await runGitCommit(this.pi, cwd, message, signal, this.commitAmend);
                disposition = await this.loadLatestDocument({
                    cwd,
                    target: `working:${cwd}`,
                    selection: "first",
                    load: (loadSignal) => loadWorkingTreeDiff(this.pi, this.contextFor(cwd, loadSignal)),
                    operationSignal: signal,
                });
                if (disposition === "applied") {
                    this.commitMessage = "";
                    this.commitMessageCaret = 0;
                    this.commitAmend = false;
                    this.commitDialogState = "closed";
                    this.statusMessage = output;
                }
            }
            catch (error) {
                if (this.setAsyncError(error)) {
                    disposition = await this.refreshWorkingTreeAfterMutationFailure(cwd, signal);
                    if (disposition === "applied")
                        this.commitDialogState = "open";
                }
            }
            finally {
                if (disposition !== "superseded") {
                    this.loadingMessage = undefined;
                    this.requestRender();
                }
            }
        });
    }
    renderCommitDialogOverlay(baseLines, width) {
        const layout = this.commitPickerOverlayLayout(baseLines.length, width);
        const overlay = this.commitDialogOverlayLines(layout.overlayWidth);
        return this.applyCommitPickerOverlay(baseLines, overlay, layout, width);
    }
    commitDialogOverlayLines(overlayWidth) {
        const row = (content) => this.commitPickerOverlayRow(content, overlayWidth);
        return [
            this.commitPickerBorder("top", overlayWidth),
            row(` ${this.theme.fg("accent", this.theme.bold(this.commitDialogTitle()))}`),
            row(` ${this.theme.fg("dim", "type message • Ctrl+X amend • ←/→ move • * generate • enter commit • ? help • esc cancel")}`),
            row(""),
            ...this.commitDialogBodyRows(row),
            row(""),
            this.commitPickerBorder("bottom", overlayWidth),
        ];
    }
    commitDialogTitle() {
        return this.commitAmend ? "Amend last commit" : "Commit staged changes";
    }
    commitDialogBodyRows(row) {
        if (this.commitDialogState === "loading") {
            return [row(` ${this.theme.fg("warning", this.loadingMessage ?? "Working…")}`)];
        }
        const mode = this.commitAmend ? this.theme.fg("warning", " amend") : this.theme.fg("muted", " normal");
        return [row(` Mode:${mode}`), row(` Message: ${this.renderCommitMessageInput()}`)];
    }
    renderCommitMessageInput() {
        const chars = this.commitMessageChars();
        const caret = this.clampCommitMessageCaret(chars);
        if (chars.length === 0) {
            return `▌${this.theme.fg("muted", "commit message")}`;
        }
        return `${chars.slice(0, caret).join("")}▌${chars.slice(caret).join("")}`;
    }
}
//# sourceMappingURL=viewer-commit-dialog.js.map