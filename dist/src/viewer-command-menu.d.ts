import { CommandMenuController } from "./command-menu-controller.js";
import type { SingleLineTextField } from "./single-line-text-field.js";
import type { GitCommand } from "./types.js";
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js";
export declare class DiffViewerCommandMenu extends DiffViewerCommitDialog {
    protected commandMenuController: CommandMenuController;
    private commandMenuRequest;
    private commandPreviewPending;
    constructor(...args: ConstructorParameters<typeof DiffViewerCommitDialog>);
    protected activeTextField(): SingleLineTextField | undefined;
    protected openCommandMenu(): void;
    protected handleCommandMenuInput(data: string): void;
    private cancelCommandMenuLoad;
    protected previewSelectedForcePush(command: GitCommand): Promise<void>;
    protected runSelectedCommand(command: GitCommand): Promise<void>;
    private forcePushWasConfirmed;
    private returnCommandMenuAfterFailure;
    private closeCommandMenu;
    private commandsAvailable;
    protected renderCommandMenuOverlay(baseLines: string[], width: number): string[];
}
