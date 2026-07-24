import type { Theme } from "@earendil-works/pi-coding-agent";
import { FilterableListState } from "./filterable-list-state.js";
import { SingleLineTextField } from "./single-line-text-field.js";
import type { CommitSummary, TagSummary } from "./types.js";
export type TagPickerState = "closed" | "loading" | "open" | "target" | "create";
export interface TagCreation {
    name: string;
    target: CommitSummary;
    annotated: boolean;
    message?: string;
}
export interface TagPickerCallbacks {
    onSelect: (tag: TagSummary) => void;
    onRequestTargets: () => void;
    onCreate: (creation: TagCreation) => void;
    onValidationError: (message: string) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare class TagPickerController {
    private readonly callbacks;
    readonly list: FilterableListState<TagSummary>;
    readonly commits: FilterableListState<CommitSummary>;
    state: TagPickerState;
    loadingMessage: string | undefined;
    createTarget: CommitSummary | undefined;
    createAnnotated: boolean;
    private readonly nameField;
    private readonly messageField;
    private createFocus;
    constructor(callbacks: TagPickerCallbacks);
    get createName(): string;
    set createName(value: string);
    get createMessage(): string;
    set createMessage(value: string);
    activeTextField(): SingleLineTextField | undefined;
    open(tags: TagSummary[]): void;
    openTargetSelection(commits: CommitSummary[]): void;
    refreshTags(tags: TagSummary[]): void;
    showTagList(): void;
    close(): void;
    handleInput(data: string): void;
    private handleEscape;
    private isCreateShortcut;
    private beginCreate;
    private handleCreateInput;
    private submitCreation;
    private clearCreation;
    renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[];
    private title;
    private hint;
    private renderBody;
    private renderTagRows;
    private renderCommitRows;
    private renderCreateRows;
}
