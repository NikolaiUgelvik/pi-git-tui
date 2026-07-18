import type { CommitSummary, DiffDocument, DiffMode, HeadState, RepositoryState } from "./types.js";
export declare function emptyDocument(title: string, subtitle: string, mode: DiffMode, commit?: CommitSummary, repositoryState?: RepositoryState, headState?: HeadState): DiffDocument;
export declare function buildDocument(mode: DiffMode, title: string, subtitle: string, raw: string, commit?: CommitSummary, stagedPaths?: Set<string>, conflictedPaths?: Set<string>, untrackedPaths?: Set<string>, repositoryState?: RepositoryState, headState?: HeadState): DiffDocument;
