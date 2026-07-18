import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
export interface CommitMessageSession {
    abort(): Promise<void>;
    dispose(): void;
    messages: unknown[];
    prompt(message: string, options: {
        expandPromptTemplates: boolean;
    }): Promise<void>;
}
export interface CommitMessageGenerationOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    createSession?: () => Promise<CommitMessageSession>;
    loadStagedDiff?: (signal?: AbortSignal) => Promise<string>;
}
export declare function generateCommitMessage(pi: ExtensionAPI, ctx: ExtensionContext, options?: CommitMessageGenerationOptions): Promise<string>;
export declare function runGitCommit(pi: ExtensionAPI, cwd: string, message: string, signal?: AbortSignal, amend?: boolean): Promise<string>;
