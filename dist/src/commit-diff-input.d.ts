import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CommitPromptBudget } from "./diff-budgets.js";
export { parseStagedRawDiff, type StagedEntry } from "./commit-staged-snapshot.js";
export interface CommitDiffInput {
    readonly text: string;
    readonly includedFiles: number;
    readonly omittedFiles: number;
    readonly capturedPatchChars: number;
}
export declare function collectCommitDiffInput(pi: ExtensionAPI, cwd: string, budget?: CommitPromptBudget, signal?: AbortSignal): Promise<CommitDiffInput>;
