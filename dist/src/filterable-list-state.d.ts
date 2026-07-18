import { SingleLineTextField } from "./single-line-text-field.js";
/**
 * Split a search query into individual tokens.
 * Trims whitespace, lowercases, and splits on one or more whitespace characters.
 */
export declare function searchTokens(query: string): string[];
/**
 * Check whether all search tokens appear in the haystack (case-insensitive).
 * Returns true for an empty token list.
 */
export declare function matchesSearch(haystack: string, tokens: string[]): boolean;
/**
 * Compute the next selection index given a key event.
 * Returns undefined if the key is not a navigation key.
 */
export declare function nextListSelectionIndex(data: string, selectedIndex: number, itemCount: number): number | undefined;
/**
 * Compute the next scroll offset to keep the selected item visible.
 * Attempts to center the selection within the viewport, but will move the
 * scroll boundary if the selection is out of view.
 */
export declare function nextListScroll(selectedIndex: number, currentScroll: number, itemCount: number, maxItems: number): number;
/**
 * Check whether the input is a printable character (no escape sequences, code point >= 32).
 */
export declare function isPrintableInput(data: string): boolean;
/**
 * Check whether the input represents an Enter/Return key.
 */
export declare function isEnter(data: string): boolean;
/**
 * Check whether the input represents a backspace key.
 */
export declare function isBackspace(data: string): boolean;
/**
 * Generic state container for a filterable list overlay.
 * Manages search query, selection, scroll, and filtered items.
 */
export interface FilterableListCacheStats {
    readonly itemsVersion: number;
    readonly filteredSnapshotBuilds: number;
}
export declare class FilterableListState<T> {
    private readonly searchText;
    readonly searchField: SingleLineTextField;
    selectedIndex: number;
    scroll: number;
    private itemsSnapshot;
    private itemsVersion;
    private filteredSnapshot;
    private filteredSnapshotBuilds;
    constructor(items: readonly T[], searchText: (item: T) => string);
    get items(): readonly T[];
    set items(items: readonly T[]);
    get searchQuery(): string;
    set searchQuery(value: string);
    get filteredItems(): readonly T[];
    get filteredCount(): number;
    get(index: number): T | undefined;
    cacheStats(): FilterableListCacheStats;
    reset(): void;
    clampSelection(): void;
    handleSearchInput(data: string): boolean;
    appendSearchChar(char: string): void;
    backspaceSearch(): void;
    moveSelection(data: string): boolean;
    visibleItems(maxItems: number): Array<{
        item: T;
        index: number;
    }>;
}
