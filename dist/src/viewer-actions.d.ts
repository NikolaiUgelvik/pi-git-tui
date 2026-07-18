import type { ConfirmAction, DiffFile, HelpContext } from "./types.js";
import { DiffViewerCommandMenu } from "./viewer-command-menu.js";
export declare class DiffViewerActions extends DiffViewerCommandMenu {
    protected confirmState: "closed" | "open" | "loading";
    protected confirmAction: ConfirmAction | undefined;
    protected confirmFile: DiffFile | undefined;
    protected isOperationLoading(): boolean;
    protected featureHelpContext(): HelpContext | undefined;
    protected hasFeatureOverlay(): boolean;
    protected renderFeatureOverlay(baseLines: string[], width: number): string[];
    protected handleFeatureOverlayInput(data: string): boolean;
    protected handleFeatureOpenInput(data: string): boolean;
    protected handleOpenInitDialogInput(data: string): boolean;
    protected handleOpenDiscardDialogInput(data: string): boolean;
    protected handleConfirmInput(data: string): void;
    protected isConfirmCancel(data: string): boolean;
    protected closeConfirmDialog(): void;
    protected runConfirmedAction(): Promise<void>;
    private confirmedSelection;
    private completeConfirmedMutation;
    private reconcileConfirmedFailure;
    private executeConfirmedMutation;
    protected executeConfirmedAction(action: ConfirmAction | undefined, cwd: string, signal: AbortSignal): Promise<string>;
    protected confirmLoadingMessage(): string;
    protected renderConfirmOverlay(baseLines: string[], width: number): string[];
    protected confirmTitle(): string;
    protected confirmBodyRows(row: (content: string) => string): string[];
}
