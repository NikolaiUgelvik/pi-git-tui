import { type ConfirmationPrompt } from "./confirmation-prompt.js";
import type { SingleLineTextField } from "./single-line-text-field.js";
import type { ConfirmAction, DiffFile, HelpContext } from "./types.js";
import { DiffViewerCommandMenu } from "./viewer-command-menu.js";
export declare class DiffViewerActions extends DiffViewerCommandMenu {
    protected confirmAction: ConfirmAction | undefined;
    protected confirmFile: DiffFile | undefined;
    protected confirmState: "closed" | "open" | "loading";
    constructor(...args: ConstructorParameters<typeof DiffViewerCommandMenu>);
    protected activeTextField(): SingleLineTextField | undefined;
    protected featureHelpContext(): HelpContext | undefined;
    protected hasFeatureOverlay(): boolean;
    protected renderFeatureOverlay(baseLines: string[], width: number): string[];
    protected handleFeatureOverlayInput(data: string): boolean;
    protected handleFeatureOpenInput(data: string): boolean;
    protected handleOpenInitDialogInput(data: string): boolean;
    protected handleOpenDiscardDialogInput(data: string): boolean;
    protected handleConfirmInput(data: string): void;
    protected closeConfirmDialog(): void;
    protected runConfirmedAction(): Promise<void>;
    protected executeConfirmedAction(action: ConfirmAction | undefined, file: DiffFile | undefined, cwd: string, signal: AbortSignal): Promise<string>;
    protected confirmLoadingMessage(): string;
    protected renderConfirmOverlay(baseLines: string[], width: number): string[];
    protected confirmPrompt(): ConfirmationPrompt;
}
