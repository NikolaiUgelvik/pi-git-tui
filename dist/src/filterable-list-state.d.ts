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
export interface FilterableListCacheStats {
    readonly itemsVersion: number;
    readonly filteredSnapshotBuilds: number;
}
/**
 * Generic state container for a filterable list overlay.
 * Manages search query, selection, scroll, and filtered items.
 *
 * The item array and searchable fields are treated as immutable until the
 * items setter is used. A single versioned filtered snapshot is retained, so
 * replacing items or changing the query has explicit, bounded invalidation.
 */
export declare class FilterableListState<T> {
    /** Function that produces a searchable string for each item. */
    private readonly searchText;
    selectedIndex: number;
    scroll: number;
    private itemsSnapshot;
    private itemsVersion;
    private currentSearchQuery;
    private filteredSnapshot;
    private filteredSnapshotBuilds;
    constructor(items: readonly T[],
    /** Function that produces a searchable string for each item. */
    searchText: (item: T) => string);
    /** Full immutable list snapshot (before filtering). */
    get items(): readonly T[];
    set items(items: readonly T[]);
    get searchQuery(): string;
    set searchQuery(query: string);
    /** Items filtered by the current search query. */
    get filteredItems(): readonly T[];
    /** Total count of filtered items. */
    get filteredCount(): number;
    /** Get the filtered item at the given index. */
    get(index: number): T | undefined;
    cacheStats(): FilterableListCacheStats;
    /** Reset selection and scroll to the beginning. */
    reset(): void;
    /** Clamp the selection index to the valid range. */
    clampSelection(): void;
    /** Append a printable character to the search query and reset scroll. */
    appendSearchChar(char: string): void;
    /** Remove the last character from the search query and reset scroll. */
    backspaceSearch(): void;
    /** Move selection with a navigation key. Returns true if handled. */
    moveSelection(data: string): boolean;
    /** Get visible items after applying scroll. */
    visibleItems(maxItems: number): Array<{
        item: T;
        index: number;
    }>;
}
