import type { HelpContext } from "./types.js";
export interface HelpAction {
    keys?: string;
    action: string;
}
export declare const HELP_TITLES: Record<HelpContext, string>;
export declare const HELP_ACTIONS: Record<HelpContext, HelpAction[]>;
