import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";
import { type FailureDetails } from "./failure-details.js";
import { type PluginSettings } from "./plugin-settings.js";
import type { DiffDocument, DiffFile, DiffSlice, WorkingTreeRefreshScope, WorkingTreeView } from "./types.js";
import { type ViewerAction } from "./viewer-action-policy.js";
import { type DiffLoadRequest, type DocumentSelection, ViewerDocumentState, type ViewerInitialDocument } from "./viewer-document-state.js";
import { type LoadOutcome, type LoadSpec, type MutationOutcome, type MutationSpec, type OperationSnapshot, type RefreshIntent, ViewerOperationCoordinator } from "./viewer-operation-coordinator.js";
export interface DocumentLoadOptions {
    runningMessage: string;
    successMessage?: string;
    selection?: DocumentSelection;
    recordFailure?: boolean;
}
export interface DiffViewerOptions {
    readonly settings: PluginSettings;
    readonly settingsListTheme: () => SettingsListTheme;
    readonly saveSettings: (settings: PluginSettings) => Promise<void>;
}
export declare class DiffViewerOperationBase {
    protected readonly ctx: ExtensionContext;
    protected readonly documentState: ViewerDocumentState;
    protected readonly done: () => void;
    protected error: string | undefined;
    protected errorDetails: string | undefined;
    protected retainedFailure: FailureDetails | undefined;
    protected readonly getTerminalRows: () => number;
    protected loadingMessage: string | undefined;
    protected readonly operationCoordinator: ViewerOperationCoordinator;
    protected readonly pi: ExtensionAPI;
    protected pluginSettings: PluginSettings;
    protected readonly requestRender: () => void;
    protected readonly settingsListTheme: () => SettingsListTheme;
    protected statusMessage: string | undefined;
    protected readonly theme: Theme;
    private readonly savePluginSettings;
    constructor(pi: ExtensionAPI, ctx: ExtensionContext, theme: Theme, initialDocument: DiffDocument | ViewerInitialDocument, done: () => void, requestRender: () => void, getTerminalRows: () => number, viewerOptions: DiffViewerOptions);
    protected get diffColumn(): number;
    protected set diffColumn(value: number);
    protected get diffScroll(): number;
    protected set diffScroll(value: number);
    protected get document(): DiffDocument;
    protected get files(): DiffFile[];
    protected get visibleSlice(): DiffSlice;
    protected get workingTreeView(): WorkingTreeView;
    protected get selectedFileIndex(): number;
    protected set selectedFileIndex(value: number);
    protected applyPluginSettings(settings: PluginSettings): void;
    protected persistPluginSettings(settings: PluginSettings): Promise<void>;
    protected activePath(): string;
    protected activeContext(signal?: AbortSignal | undefined): ExtensionContext;
    protected operationSnapshot(): OperationSnapshot;
    protected currentFailureDetails(): FailureDetails | undefined;
    protected requireViewerAction(action: ViewerAction): boolean;
    protected canStartForegroundOperation(action: string): boolean;
    protected prepareOperation(): void;
    protected retainFailureDetails(failure: FailureDetails): void;
    protected runMutation<T, R>(spec: MutationSpec<T, R>): Promise<MutationOutcome<T>>;
    protected runLoad<T>(spec: LoadSpec<T>): Promise<LoadOutcome<T>>;
    protected documentRefreshIntent(request?: DiffLoadRequest, selection?: DocumentSelection): RefreshIntent<DiffDocument>;
    protected workingTreeRefreshIntent(cwd?: string, selection?: DocumentSelection, scope?: WorkingTreeRefreshScope): RefreshIntent<DiffDocument>;
    protected loadDocument(request: DiffLoadRequest, options: DocumentLoadOptions): Promise<LoadOutcome<DiffDocument>>;
    protected reloadCurrentDocument(): Promise<LoadOutcome<DiffDocument>>;
    protected retryRefreshOnly(): Promise<LoadOutcome<unknown>>;
    protected cancelActiveOperation(): boolean;
    protected isOperationBusy(): boolean;
    protected showOperationRejection(action: string): void;
    protected showUnexpectedError(error: unknown): void;
}
