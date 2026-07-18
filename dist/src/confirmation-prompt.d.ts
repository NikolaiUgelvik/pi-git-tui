import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DiffFile } from "./types.js";
export interface ConfirmationPrompt {
    title: string;
    details: string[];
    consequence?: string;
    confirmLabel: string;
}
export type ConfirmationDecision = "confirm" | "cancel" | undefined;
export declare function confirmationDecision(data: string, allowLegacyQ?: boolean): ConfirmationDecision;
export declare function confirmationHint(prompt: ConfirmationPrompt): string;
export declare function initializationConfirmationPrompt(path: string): ConfirmationPrompt;
export declare function discardConfirmationPrompt(file: DiffFile | undefined): ConfirmationPrompt;
export interface ConfirmationBodyOptions {
    compact?: boolean;
    maxRows?: number;
    width?: number;
}
export declare function confirmationBodyLines(prompt: ConfirmationPrompt, theme: Theme, options?: ConfirmationBodyOptions): string[];
