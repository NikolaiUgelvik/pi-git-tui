import type { CommitSummary, DiffDocument, DiffMode, RepositoryState } from "./types.js";
export declare function emptyDocument(title: string, subtitle: string, mode: DiffMode, commit?: CommitSummary, repositoryState?: RepositoryState): DiffDocument;
export declare function buildDocument(mode: DiffMode, title: string, subtitle: string, raw: string, commit?: CommitSummary, stagedPaths?: Set<string>, conflictedPaths?: Set<string>, untrackedPaths?: Set<string>): DiffDocument;
