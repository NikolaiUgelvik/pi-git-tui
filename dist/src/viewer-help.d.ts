import type { DiffDocument, HelpContext } from "./types.js";
import { type ViewerAction } from "./viewer-action-policy.js";
export interface HelpAction {
    keys?: string;
    action: string;
    viewerAction?: ViewerAction;
}
export declare const HELP_TITLES: Record<HelpContext, string>;
export declare const HELP_ACTIONS: Record<HelpContext, HelpAction[]>;
export declare function helpActionsForDocument(context: HelpContext, document: DiffDocument): HelpAction[];
