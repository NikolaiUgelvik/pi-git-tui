import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_VIEW_HEIGHT = 34;
const COMMIT_LIMIT = 200;
const GIT_TIMEOUT_MS = 10_000;
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024;

type DiffMode = "working" | "commit";

type CommitSummary = {
	hash: string;
	message: string;
};

type CommitPickerItem =
	| { type: "working" }
	| { type: "commit"; commit: CommitSummary };

type DiffFile = {
	path: string;
	oldPath?: string;
	newPath?: string;
	status: "added" | "deleted" | "modified" | "renamed" | "copied" | "binary";
	lines: string[];
};

type DiffDocument = {
	mode: DiffMode;
	title: string;
	subtitle: string;
	raw: string;
	files: DiffFile[];
	commit?: CommitSummary;
};

type GitExecResult = {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
};

type FocusPanel = "tree" | "diff";

function isEnter(data: string): boolean {
	return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n";
}

function isPageUp(data: string): boolean {
	return matchesKey(data, "pageUp") || data === "\x1b[5~";
}

function isPageDown(data: string): boolean {
	return matchesKey(data, "pageDown") || data === "\x1b[6~";
}

function isPrintableInput(data: string): boolean {
	if (data.length === 0 || data.includes("\x1b")) return false;
	return [...data].every((char) => {
		const codePoint = char.codePointAt(0);
		return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
	});
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function padToWidth(text: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(text));
	return text + " ".repeat(padding);
}

function fit(text: string, width: number): string {
	if (width <= 0) return "";
	// Raw git diffs can contain tabs. Terminals expand tabs to multiple cells,
	// while string-width helpers can undercount them, so normalize before sizing.
	const normalized = text.replace(/\t/g, "    ");
	return padToWidth(truncateToWidth(normalized, width, "…"), width);
}

function unquoteGitPath(path: string): string {
	let value = path.trim();
	if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2);
	if (value === "/dev/null") return value;
	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			return JSON.parse(value) as string;
		} catch {
			return value.slice(1, -1);
		}
	}
	return value;
}

function pathFromDiffGit(line: string): string | undefined {
	const match = line.match(/^diff --git (.+) (.+)$/);
	if (!match) return undefined;
	return unquoteGitPath(match[2] ?? match[1] ?? "");
}

function statusFromLines(lines: string[], oldPath?: string, newPath?: string): DiffFile["status"] {
	if (lines.some((line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))) return "binary";
	if (lines.some((line) => line.startsWith("rename from "))) return "renamed";
	if (lines.some((line) => line.startsWith("copy from "))) return "copied";
	if (oldPath === "/dev/null") return "added";
	if (newPath === "/dev/null") return "deleted";
	return "modified";
}

function statusGlyph(status: DiffFile["status"]): string {
	switch (status) {
		case "added":
			return "A";
		case "deleted":
			return "D";
		case "renamed":
			return "R";
		case "copied":
			return "C";
		case "binary":
			return "B";
		case "modified":
			return "M";
	}
}

function parseDiff(raw: string): DiffFile[] {
	const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const rawLines = normalized.length > 0 ? normalized.split("\n") : [];
	if (rawLines[rawLines.length - 1] === "") rawLines.pop();

	const files: DiffFile[] = [];
	let current: string[] = [];

	function flush() {
		if (current.length === 0) return;

		let oldPath: string | undefined;
		let newPath: string | undefined;
		let fallbackPath: string | undefined;

		for (const line of current) {
			if (line.startsWith("diff --git ")) fallbackPath = pathFromDiffGit(line) ?? fallbackPath;
			if (line.startsWith("--- ")) oldPath = unquoteGitPath(line.slice(4));
			if (line.startsWith("+++ ")) newPath = unquoteGitPath(line.slice(4));
			if (line.startsWith("rename to ")) newPath = unquoteGitPath(line.slice("rename to ".length));
			if (line.startsWith("rename from ")) oldPath = unquoteGitPath(line.slice("rename from ".length));
		}

		const path = newPath && newPath !== "/dev/null" ? newPath : oldPath && oldPath !== "/dev/null" ? oldPath : fallbackPath;
		files.push({
			path: path ?? "(unknown)",
			oldPath,
			newPath,
			status: statusFromLines(current, oldPath, newPath),
			lines: current,
		});
		current = [];
	}

	for (const line of rawLines) {
		if (line.startsWith("diff --git ") && current.length > 0) flush();
		current.push(line);
	}
	flush();

	return files;
}

function emptyDocument(title: string, subtitle: string, mode: DiffMode, commit?: CommitSummary): DiffDocument {
	return { mode, title, subtitle, raw: "", files: [], commit };
}

function buildDocument(mode: DiffMode, title: string, subtitle: string, raw: string, commit?: CommitSummary): DiffDocument {
	const files = parseDiff(raw);
	return { mode, title, subtitle, raw, files, commit };
}

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<GitExecResult> {
	return pi.exec("git", args, { cwd, signal, timeout: GIT_TIMEOUT_MS });
}

async function ensureGitRepository(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
	const result = await git(pi, cwd, ["rev-parse", "--show-toplevel"], signal);
	if (result.code !== 0) return undefined;
	return result.stdout.trim();
}

async function hasHead(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<boolean> {
	const result = await git(pi, cwd, ["rev-parse", "--verify", "HEAD"], signal);
	return result.code === 0;
}

async function listUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
	const result = await git(pi, cwd, ["ls-files", "--others", "--exclude-standard", "-z"], signal);
	if (result.code !== 0 || !result.stdout) return [];
	return result.stdout.split("\0").filter(Boolean);
}

async function readUntrackedDiff(pi: ExtensionAPI, cwd: string, file: string, signal?: AbortSignal): Promise<string> {
	const trackedResult = await git(pi, cwd, ["-c", "core.quotepath=false", "ls-files", "--stage", "--", file], signal);
	if (trackedResult.code === 0 && trackedResult.stdout.trim()) return "";

	const sizeResult = await git(pi, cwd, ["-c", "core.quotepath=false", "cat-file", "-e", `HEAD:${file}`], signal);
	if (sizeResult.code === 0) return "";

	const nodeStat = await stat(resolve(cwd, file)).catch(() => undefined);
	if (!nodeStat?.isFile() || nodeStat.size > MAX_UNTRACKED_FILE_BYTES) return "";

	const result = await git(
		pi,
		cwd,
		["-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", file],
		signal,
	);
	return result.stdout;
}

async function loadWorkingTreeDiff(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<DiffDocument> {
	const root = await ensureGitRepository(pi, ctx.cwd, ctx.signal);
	if (!root) return emptyDocument("Not a git repository", ctx.cwd, "working");

	const headExists = await hasHead(pi, root, ctx.signal);
	const args = headExists
		? ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--find-renames", "--find-copies", "--color=never", "HEAD", "--"]
		: ["-c", "core.quotepath=false", "diff", "--cached", "--no-ext-diff", "--find-renames", "--find-copies", "--color=never", "--"];

	const diffResult = await git(pi, root, args, ctx.signal);
	let raw = diffResult.stdout;

	const untracked = await listUntrackedFiles(pi, root, ctx.signal);
	for (const file of untracked) {
		const untrackedDiff = await readUntrackedDiff(pi, root, file, ctx.signal);
		if (untrackedDiff.trim()) raw += `${raw.endsWith("\n") || raw.length === 0 ? "" : "\n"}${untrackedDiff}`;
	}

	const title = headExists ? "Working tree vs HEAD" : "Working tree (no commits yet)";
	const subtitle = root;
	return buildDocument("working", title, subtitle, raw);
}

async function loadCommits(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<CommitSummary[]> {
	const root = await ensureGitRepository(pi, cwd, signal);
	if (!root) return [];
	const result = await git(pi, root, ["log", `--max-count=${COMMIT_LIMIT}`, "--pretty=format:%h%x09%s"], signal);
	if (result.code !== 0 || !result.stdout.trim()) return [];
	return result.stdout.split("\n").map((line) => {
		const [hash = "", ...messageParts] = line.split("\t");
		return { hash, message: messageParts.join("\t") };
	});
}

async function loadCommitDiff(
	pi: ExtensionAPI,
	cwd: string,
	commit: CommitSummary,
	signal?: AbortSignal,
): Promise<DiffDocument> {
	const root = (await ensureGitRepository(pi, cwd, signal)) ?? cwd;
	const result = await git(
		pi,
		root,
		["-c", "core.quotepath=false", "show", "--format=", "--no-ext-diff", "--find-renames", "--find-copies", "--color=never", commit.hash, "--"],
		signal,
	);
	return buildDocument("commit", `Commit ${commit.hash}`, commit.message, result.stdout, commit);
}

type TreeRow = {
	label: string;
	fileIndex?: number;
	depth: number;
	isLast: boolean;
};

function buildTreeRows(files: DiffFile[]): TreeRow[] {
	const rows: TreeRow[] = [];
	const seenDirs = new Set<string>();

	const byPath = new Map(files.map((file, index) => [file.path, { file, index }]));
	const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

	for (const file of sortedFiles) {
		const info = byPath.get(file.path);
		if (!info) continue;
		const displayParts = file.path.split("/").filter(Boolean);
		const dirs = displayParts.slice(0, -1);
		let dirPath = "";
		for (let i = 0; i < dirs.length; i++) {
			dirPath = dirPath ? `${dirPath}/${dirs[i]}` : dirs[i] ?? "";
			if (seenDirs.has(dirPath)) continue;
			seenDirs.add(dirPath);
			rows.push({ label: dirs[i] ?? "", depth: i, isLast: false });
		}
		rows.push({
			label: `${statusGlyph(file.status)} ${displayParts[displayParts.length - 1] ?? file.path}`,
			fileIndex: info.index,
			depth: Math.max(0, displayParts.length - 1),
			isLast: true,
		});
	}

	return rows;
}

class DiffViewer {
	private document: DiffDocument;
	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionCommandContext;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly requestRender: () => void;

	private selectedFileIndex = 0;
	private diffScroll = 0;
	private commitScroll = 0;
	private selectedCommitIndex = 0;
	private focusedPanel: FocusPanel = "tree";
	private commits: CommitSummary[] = [];
	private commitSearchQuery = "";
	private pickerState: "closed" | "loading" | "open" = "closed";
	private loadingMessage: string | undefined;
	private error: string | undefined;

	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		theme: Theme,
		document: DiffDocument,
		done: () => void,
		requestRender: () => void,
		private readonly getTerminalRows: () => number,
	) {
		this.pi = pi;
		this.ctx = ctx;
		this.theme = theme;
		this.document = document;
		this.done = done;
		this.requestRender = requestRender;
		this.normalizeSelection();
	}

	handleInput(data: string): void {
		if (this.pickerState !== "closed") {
			this.handleCommitPickerInput(data);
			return;
		}

		if (data === "q" || data === "Q") {
			this.done();
			return;
		}

		if (data === "c" || data === "C") {
			void this.openCommitPicker();
			return;
		}

		if (matchesKey(data, "tab")) {
			this.focusedPanel = this.focusedPanel === "tree" ? "diff" : "tree";
		} else if (data === "n" || data === "N") {
			this.moveFile(1);
		} else if (data === "p" || data === "P") {
			this.moveFile(-1);
		} else if (matchesKey(data, "up") || data === "k" || data === "K") {
			if (this.focusedPanel === "tree") this.moveFile(-1);
			else this.scrollDiff(-1);
		} else if (matchesKey(data, "down") || data === "j" || data === "J") {
			if (this.focusedPanel === "tree") this.moveFile(1);
			else this.scrollDiff(1);
		} else if (isPageUp(data)) {
			this.scrollDiff(-this.pageScrollSize());
		} else if (isPageDown(data) || matchesKey(data, "space")) {
			this.scrollDiff(this.pageScrollSize());
		} else if (matchesKey(data, "home")) {
			if (this.focusedPanel === "tree") this.selectTreeEdge("first");
			else this.diffScroll = 0;
		} else if (matchesKey(data, "end")) {
			if (this.focusedPanel === "tree") this.selectTreeEdge("last");
			else this.diffScroll = Number.MAX_SAFE_INTEGER;
		}
		this.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const innerWidth = Math.max(10, width - 2);
		const separatorWidth = 1;
		const panelWidth = Math.max(2, innerWidth - separatorWidth);
		const minLeft = Math.min(24, Math.max(1, Math.floor(panelWidth / 3)));
		const maxLeft = Math.max(1, panelWidth - 1);
		const leftWidth = Math.max(1, Math.min(maxLeft, Math.max(minLeft, Math.min(42, Math.floor(innerWidth * 0.34)))));
		const rightWidth = Math.max(1, panelWidth - leftWidth);
		const lines: string[] = [];
		const side = this.theme.fg("border", "│");
		const frame = (content: string) => fit(`${side}${fit(content, innerWidth)}${side}`, width);

		const viewHeight = this.viewHeight();
		const bodyHeight = viewHeight - 1;
		lines.push(fit(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`), width));
		lines.push(frame(this.renderHeader(innerWidth)));
		lines.push(frame(this.renderSubtitle(innerWidth)));
		lines.push(fit(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`), width));

		const treeLines = [this.renderPanelTitle("tree", leftWidth), ...this.renderTree(leftWidth, bodyHeight)];
		const diffLines = [this.renderPanelTitle("diff", rightWidth), ...this.renderDiff(rightWidth, bodyHeight)];
		const sep = this.theme.fg("border", "│");
		for (let i = 0; i < viewHeight; i++) {
			lines.push(frame(`${treeLines[i] ?? " ".repeat(leftWidth)}${sep}${diffLines[i] ?? " ".repeat(rightWidth)}`));
		}

		lines.push(fit(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`), width));
		lines.push(frame(this.renderFooter(innerWidth)));
		lines.push(fit(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`), width));
		if (this.pickerState !== "closed") return this.renderCommitPickerOverlay(lines, width);
		return lines.map((line) => fit(line, width));
	}

	private viewHeight(): number {
		// The custom diff viewer is shown as an overlay with a 1-row margin. Keep the
		// component shorter than the visible terminal so re-renders never push content
		// into scrollback when users browse with arrow keys or PageUp/PageDown.
		const maxTotalLines = Math.max(10, this.getTerminalRows() - 2);
		const chromeLines = 7; // border, header, subtitle, dividers, footer, border
		return Math.max(5, Math.min(MAX_VIEW_HEIGHT, maxTotalLines - chromeLines));
	}

	private pageScrollSize(): number {
		return Math.max(1, Math.floor((this.viewHeight() - 1) / 2));
	}

	private renderHeader(width: number): string {
		const fileCount = this.document.files.length;
		const count = fileCount === 1 ? "1 file" : `${fileCount} files`;
		const title = `${this.theme.bold(this.document.title)} ${this.theme.fg("muted", `(${count})`)}`;
		return fit(title, width);
	}

	private renderSubtitle(width: number): string {
		return fit(this.theme.fg("dim", this.document.subtitle || " "), width);
	}

	private renderPanelTitle(panel: FocusPanel, width: number): string {
		const focused = this.focusedPanel === panel;
		const label = panel === "tree" ? "Files" : "Diff";
		const marker = focused ? "▶ " : "  ";
		const text = `${marker}${label}`;
		return fit(focused ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text), width);
	}

	private renderFooter(width: number): string {
		if (this.error) return fit(this.theme.fg("warning", `⚠ ${this.error} • q close`), width);
		const focusLabel = this.focusedPanel === "tree" ? "files" : "diff";
		const arrows = this.focusedPanel === "tree" ? "↑↓/j/k files" : "↑↓/j/k code";
		return fit(
			this.theme.fg("dim", `focus:${focusLabel} • tab switch • n/p files • ${arrows} • PgUp/PgDn scroll • Home/End jump • c commits • q close`),
			width,
		);
	}

	private renderTree(width: number, height: number): string[] {
		if (this.document.files.length === 0) {
			return [fit(this.theme.fg("muted", "  No changes"), width), ...Array(height - 1).fill(" ".repeat(width))];
		}

		const rows = buildTreeRows(this.document.files);
		const selectedRow = Math.max(
			0,
			rows.findIndex((row) => row.fileIndex === this.selectedFileIndex),
		);
		const start = Math.max(0, Math.min(selectedRow - Math.floor(height / 2), Math.max(0, rows.length - height)));
		const visibleRows = rows.slice(start, start + height);
		const isTreeFocused = this.focusedPanel === "tree";
		const lines = visibleRows.map((row) => {
			const isSelected = row.fileIndex === this.selectedFileIndex;
			const indent = "  ".repeat(row.depth);
			const icon = row.fileIndex === undefined ? "▸ " : "  ";
			const raw = `${indent}${icon}${row.label}`;
			const colored = row.fileIndex === undefined
				? this.theme.fg("muted", raw)
				: this.colorTreeFile(raw, this.document.files[row.fileIndex]?.status ?? "modified", isSelected);
			return fit(isSelected && isTreeFocused ? this.theme.bg("selectedBg", colored) : colored, width);
		});
		while (lines.length < height) lines.push(" ".repeat(width));
		return lines;
	}

	private colorTreeFile(line: string, status: DiffFile["status"], selected: boolean): string {
		if (selected) return this.theme.fg("accent", line);
		switch (status) {
			case "added":
				return this.theme.fg("success", line);
			case "deleted":
				return this.theme.fg("error", line);
			case "renamed":
			case "copied":
				return this.theme.fg("warning", line);
			case "binary":
				return this.theme.fg("muted", line);
			case "modified":
				return this.theme.fg("text", line);
		}
	}

	private renderDiff(width: number, height: number): string[] {
		const file = this.document.files[this.selectedFileIndex];
		if (!file) {
			const message = this.document.mode === "working"
				? "Working tree is clean. Press c to inspect commit history."
				: "This commit has no textual diff.";
			return [fit(this.theme.fg("muted", message), width), ...Array(height - 1).fill(" ".repeat(width))];
		}

		const diffLines = file.lines;
		const maxScroll = Math.max(0, diffLines.length - height);
		this.diffScroll = Math.max(0, Math.min(this.diffScroll, maxScroll));
		const visible = diffLines.slice(this.diffScroll, this.diffScroll + height).map((line) => fit(this.colorDiffLine(line), width));
		while (visible.length < height) visible.push(" ".repeat(width));
		return visible;
	}

	private colorDiffLine(line: string): string {
		if (line.startsWith("+") && !line.startsWith("+++")) return this.theme.fg("toolDiffAdded", line);
		if (line.startsWith("-") && !line.startsWith("---")) return this.theme.fg("toolDiffRemoved", line);
		if (line.startsWith("@@")) return this.theme.fg("accent", line);
		if (line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---")) {
			return this.theme.fg("toolTitle", this.theme.bold(line));
		}
		if (line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity ") || line.startsWith("rename ")) {
			return this.theme.fg("muted", line);
		}
		return this.theme.fg("toolDiffContext", line);
	}

	private moveFile(delta: number): void {
		const fileOrder = this.treeFileOrder();
		if (fileOrder.length === 0) return;
		const currentOrderIndex = Math.max(0, fileOrder.indexOf(this.selectedFileIndex));
		const nextOrderIndex = Math.max(0, Math.min(fileOrder.length - 1, currentOrderIndex + delta));
		this.selectedFileIndex = fileOrder[nextOrderIndex] ?? this.selectedFileIndex;
		this.diffScroll = 0;
	}

	private selectTreeEdge(edge: "first" | "last"): void {
		const fileOrder = this.treeFileOrder();
		if (fileOrder.length === 0) return;
		this.selectedFileIndex = fileOrder[edge === "first" ? 0 : fileOrder.length - 1] ?? this.selectedFileIndex;
		this.diffScroll = 0;
	}

	private treeFileOrder(): number[] {
		return buildTreeRows(this.document.files)
			.map((row) => row.fileIndex)
			.filter((index): index is number => index !== undefined);
	}

	private scrollDiff(delta: number): void {
		this.diffScroll = Math.max(0, this.diffScroll + delta);
	}

	private normalizeSelection(): void {
		this.selectedFileIndex = Math.max(0, Math.min(this.document.files.length - 1, this.selectedFileIndex));
		this.diffScroll = 0;
	}

	private async openCommitPicker(): Promise<void> {
		this.error = undefined;
		this.commitSearchQuery = "";
		this.selectedCommitIndex = 0;
		this.commitScroll = 0;
		this.pickerState = "loading";
		this.loadingMessage = "Loading commits…";
		this.requestRender();
		try {
			this.commits = await loadCommits(this.pi, this.ctx.cwd, this.ctx.signal);
			this.pickerState = "open";
		} catch (error) {
			this.pickerState = "closed";
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loadingMessage = undefined;
			this.requestRender();
		}
	}

	private handleCommitPickerInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.pickerState = "closed";
			this.requestRender();
			return;
		}
		if (this.pickerState === "loading") return;

		if (matchesKey(data, "backspace") || data === "\b" || data === "\x7f") {
			if (this.commitSearchQuery.length > 0) {
				this.commitSearchQuery = [...this.commitSearchQuery].slice(0, -1).join("");
				this.resetCommitPickerScroll();
			}
		} else if (isPrintableInput(data)) {
			this.commitSearchQuery += data;
			this.resetCommitPickerScroll();
		} else {
			const itemCount = this.commitPickerItemCount();
			if (matchesKey(data, "up")) {
				this.selectedCommitIndex = Math.max(0, this.selectedCommitIndex - 1);
			} else if (matchesKey(data, "down")) {
				this.selectedCommitIndex = Math.min(Math.max(0, itemCount - 1), this.selectedCommitIndex + 1);
			} else if (isPageUp(data)) {
				this.selectedCommitIndex = Math.max(0, this.selectedCommitIndex - 10);
			} else if (isPageDown(data)) {
				this.selectedCommitIndex = Math.min(Math.max(0, itemCount - 1), this.selectedCommitIndex + 10);
			} else if (matchesKey(data, "home")) {
				this.selectedCommitIndex = 0;
			} else if (matchesKey(data, "end")) {
				this.selectedCommitIndex = Math.max(0, itemCount - 1);
			} else if (isEnter(data)) {
				const item = this.commitPickerItem(this.selectedCommitIndex);
				if (item?.type === "working") void this.selectWorkingTree();
				else if (item?.type === "commit") void this.selectCommit(item.commit);
			}
		}
		this.clampCommitSelection();
		this.requestRender();
	}

	private resetCommitPickerScroll(): void {
		this.selectedCommitIndex = 0;
		this.commitScroll = 0;
	}

	private clampCommitSelection(): void {
		this.selectedCommitIndex = Math.max(0, Math.min(Math.max(0, this.commitPickerItemCount() - 1), this.selectedCommitIndex));
	}

	private commitPickerItemCount(): number {
		return this.commitPickerItems().length;
	}

	private commitPickerItem(index: number): CommitPickerItem | undefined {
		return this.commitPickerItems()[index];
	}

	private commitPickerItems(): CommitPickerItem[] {
		const workingItem: CommitPickerItem = { type: "working" };
		const commitItems = this.commits.map((commit): CommitPickerItem => ({ type: "commit", commit }));
		const tokens = this.commitSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (tokens.length === 0) return [workingItem, ...commitItems];

		const items: CommitPickerItem[] = [];
		if (this.matchesCommitSearch("working tree staged unstaged", tokens)) items.push(workingItem);
		items.push(...commitItems.filter((item) => item.type === "commit" && this.matchesCommitSearch(`${item.commit.hash} ${item.commit.message}`, tokens)));
		return items;
	}

	private matchesCommitSearch(value: string, tokens: string[]): boolean {
		const haystack = value.toLowerCase();
		return tokens.every((token) => haystack.includes(token));
	}

	private async selectWorkingTree(): Promise<void> {
		this.pickerState = "loading";
		this.loadingMessage = "Loading working tree…";
		this.requestRender();
		try {
			this.document = await loadWorkingTreeDiff(this.pi, this.ctx);
			this.selectedFileIndex = 0;
			this.diffScroll = 0;
			this.error = undefined;
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.pickerState = "closed";
			this.loadingMessage = undefined;
			this.requestRender();
		}
	}

	private renderCommitSearchLine(): string {
		const query = this.commitSearchQuery.length > 0
			? `${this.commitSearchQuery}▌`
			: this.theme.fg("muted", "type to filter commits");
		const matchCount = this.commitPickerItems().filter((item) => item.type === "commit").length;
		const countLabel = this.commitSearchQuery.trim().length > 0 ? ` ${this.theme.fg("muted", `(${matchCount}/${this.commits.length})`)}` : "";
		return ` Search: ${query}${countLabel}`;
	}

	private async selectCommit(commit: CommitSummary): Promise<void> {
		this.pickerState = "loading";
		this.loadingMessage = `Loading ${commit.hash}…`;
		this.requestRender();
		try {
			this.document = await loadCommitDiff(this.pi, this.ctx.cwd, commit, this.ctx.signal);
			this.selectedFileIndex = 0;
			this.diffScroll = 0;
			this.error = undefined;
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.pickerState = "closed";
			this.loadingMessage = undefined;
			this.requestRender();
		}
	}

	private renderCommitPickerOverlay(baseLines: string[], width: number): string[] {
		const overlayWidth = Math.max(50, Math.min(width - 4, 88));
		const leftPad = Math.max(0, Math.floor((width - overlayWidth) / 2));
		const startLine = 5;
		const maxItems = Math.max(1, Math.min(13, baseLines.length - startLine - 7));
		const overlay: string[] = [];
		const border = this.theme.fg("border", `╭${"─".repeat(overlayWidth - 2)}╮`);
		const bottom = this.theme.fg("border", `╰${"─".repeat(overlayWidth - 2)}╯`);
		const row = (content: string) => {
			const inner = fit(content, overlayWidth - 2);
			return `${this.theme.fg("border", "│")}${inner}${this.theme.fg("border", "│")}`;
		};

		overlay.push(border);
		overlay.push(row(` ${this.theme.fg("accent", this.theme.bold("Select commit"))}`));
		overlay.push(row(` ${this.theme.fg("dim", "type search • backspace edit • ↑↓ navigate • enter select • esc cancel")}`));
		overlay.push(row(this.renderCommitSearchLine()));
		overlay.push(row(""));

		if (this.pickerState === "loading") {
			overlay.push(row(` ${this.theme.fg("warning", this.loadingMessage ?? "Loading…")}`));
		} else {
			this.clampCommitSelection();
			const itemCount = this.commitPickerItemCount();
			if (itemCount === 0) {
				overlay.push(row(` ${this.theme.fg("muted", "No matching commits")}`));
			} else {
				const maxScroll = Math.max(0, itemCount - maxItems);
				this.commitScroll = Math.max(
					0,
					Math.min(this.commitScroll, maxScroll, Math.max(0, this.selectedCommitIndex - Math.floor(maxItems / 2))),
				);
				if (this.selectedCommitIndex < this.commitScroll) this.commitScroll = this.selectedCommitIndex;
				if (this.selectedCommitIndex >= this.commitScroll + maxItems) this.commitScroll = this.selectedCommitIndex - maxItems + 1;

				for (let i = this.commitScroll; i < Math.min(itemCount, this.commitScroll + maxItems); i++) {
					const item = this.commitPickerItem(i);
					if (!item) continue;
					const selected = i === this.selectedCommitIndex;
					const line = item.type === "working"
						? ` ${selected ? "▶" : " "} ${this.theme.fg("accent", "working tree")} ${this.theme.fg("muted", "staged + unstaged")}`
						: ` ${selected ? "▶" : " "} ${this.theme.fg("accent", item.commit.hash)} ${item.commit.message}`;
					overlay.push(row(selected ? this.theme.bg("selectedBg", line) : line));
				}
			}
		}

		overlay.push(row(""));
		overlay.push(bottom);

		const result = [...baseLines];
		for (let i = 0; i < overlay.length; i++) {
			const base = stripAnsi(result[startLine + i] ?? "");
			const prefix = base.slice(0, leftPad).padEnd(leftPad, " ");
			const suffixStart = leftPad + overlayWidth;
			const suffix = suffixStart < base.length ? base.slice(suffixStart) : "";
			result[startLine + i] = fit(prefix + overlay[i] + suffix, width);
		}
		return result.map((line) => fit(line, width));
	}
}

export default function gitDiffExtension(pi: ExtensionAPI) {
	pi.registerCommand("diff", {
		description: "Open an interactive git diff and commit viewer",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/diff requires interactive mode", "error");
				return;
			}

			let initialDocument: DiffDocument;
			try {
				initialDocument = await loadWorkingTreeDiff(pi, ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				initialDocument = emptyDocument("Failed to load git diff", message, "working");
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				return new DiffViewer(
					pi,
					ctx,
					theme,
					initialDocument,
					() => done(undefined),
					() => tui.requestRender(),
					() => tui.terminal.rows,
				);
			}, {
				overlay: true,
				overlayOptions: {
					width: "100%",
					maxHeight: "100%",
					anchor: "center",
					margin: 1,
				},
			});
		},
	});
}
