import { CommandMenuController } from "./command-menu-controller.js";
import type { GitCommand, WorkingTreeRefreshScope } from "./types.js";
import { DiffViewerCommitDialog } from "./viewer-commit-dialog.js";
export declare class DiffViewerCommandMenu extends DiffViewerCommitDialog {
    protected commandMenuController: CommandMenuController;
    constructor(...args: ConstructorParameters<typeof DiffViewerCommitDialog>);
    protected openCommandMenu(): void;
    protected handleCommandMenuInput(data: string): void;
    protected runSelectedCommand(command: GitCommand): Promise<void>;
    protected refreshDocumentAfterCommand(scope: WorkingTreeRefreshScope, cwd: string, operationSignal: AbortSignal): Promise<"applied" | "superseded">;
    protected refreshDocumentAfterFailedCommand(scope: WorkingTreeRefreshScope, cwd: string, operationSignal: AbortSignal): Promise<"applied" | "superseded">;
    protected renderCommandMenuOverlay(baseLines: string[], width: number): string[];
}
