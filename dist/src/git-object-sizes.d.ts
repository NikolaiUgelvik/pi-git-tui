import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type LiteralPathBudget } from "./diff-budgets.js";
export interface ObjectSizeBudget extends LiteralPathBudget {
    readonly concurrency: number;
}
export interface IndexPathSizes {
    readonly sizes: ReadonlyMap<string, number>;
    readonly changedPaths: ReadonlySet<string>;
    readonly identity: string;
}
export declare function loadHeadPathSizes(pi: ExtensionAPI, root: string, revision: string, paths: readonly string[], budget: LiteralPathBudget, signal?: AbortSignal): Promise<Map<string, number>>;
export declare function loadIndexPathIdentity(pi: ExtensionAPI, root: string, paths: readonly string[], budget: LiteralPathBudget, signal?: AbortSignal): Promise<string>;
export declare function loadIndexPathSizes(pi: ExtensionAPI, root: string, paths: readonly string[], budget: ObjectSizeBudget, signal?: AbortSignal): Promise<IndexPathSizes>;
