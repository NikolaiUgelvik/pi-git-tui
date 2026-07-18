import type { DiffDocument } from "./types.js";
export type ViewerAction = "navigate" | "reload" | "toggleView" | "stageFile" | "stageAll" | "commit" | "discard" | "initialize" | "branches" | "stashes" | "commands" | "commitPicker" | "workingTree" | "worktrees" | "help" | "close";
export interface ViewerActionAvailability {
    available: boolean;
    reason?: string;
}
export declare function viewerActionAvailability(document: DiffDocument, action: ViewerAction): ViewerActionAvailability;
export declare function isViewerActionAvailable(document: DiffDocument, action: ViewerAction): boolean;
