import { type AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
export declare function promptAgentWithAbort(session: Pick<AgentSession, "abort" | "prompt" | "subscribe">, prompt: string, signal?: AbortSignal): Promise<void>;
export declare function generateCommitMessage(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string>;
export declare function runGitCommit(pi: ExtensionAPI, cwd: string, message: string, signal?: AbortSignal, amend?: boolean): Promise<string>;
