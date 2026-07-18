import { matchesKey } from "@earendil-works/pi-tui"

// --- Search utilities ---

/**
 * Split a search query into individual tokens.
 * Trims whitespace, lowercases, and splits on one or more whitespace characters.
 */
export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Check whether all search tokens appear in the haystack (case-insensitive).
 * Returns true for an empty token list.
 */
export function matchesSearch(haystack: string, tokens: string[]): boolean {
  const lower = haystack.toLowerCase()
  return tokens.every((token) => lower.includes(token))
}

// --- Navigation ---

/**
 * Compute the next selection index given a key event.
 * Returns undefined if the key is not a navigation key.
 */
export function nextListSelectionIndex(data: string, selectedIndex: number, itemCount: number): number | undefined {
  const lastIndex = Math.max(0, itemCount - 1)
  if (matchesKey(data, "up") || data === "k" || data === "K") {
    return Math.max(0, selectedIndex - 1)
  }
  if (matchesKey(data, "down") || data === "j" || data === "J") {
    return Math.min(lastIndex, selectedIndex + 1)
  }
  return nextListSelectionPageIndex(data, selectedIndex, lastIndex)
}

/**
 * Page-level selection navigation (PageUp, PageDown, Home, End).
 * Returns undefined if the key is not a page navigation key.
 */
function nextListSelectionPageIndex(data: string, selectedIndex: number, lastIndex: number): number | undefined {
  if (isPageUp(data)) {
    return Math.max(0, selectedIndex - 10)
  }
  if (isPageDown(data)) {
    return Math.min(lastIndex, selectedIndex + 10)
  }
  if (matchesKey(data, "home")) {
    return 0
  }
  if (matchesKey(data, "end")) {
    return lastIndex
  }
}

// --- Scroll calculation ---

/**
 * Compute the next scroll offset to keep the selected item visible.
 * Attempts to center the selection within the viewport, but will move the
 * scroll boundary if the selection is out of view.
 */
export function nextListScroll(
  selectedIndex: number,
  currentScroll: number,
  itemCount: number,
  maxItems: number,
): number {
  const maxScroll = Math.max(0, itemCount - maxItems)
  const centeredScroll = Math.max(0, selectedIndex - Math.floor(maxItems / 2))
  let scroll = Math.max(0, Math.min(currentScroll, maxScroll, centeredScroll))
  if (selectedIndex < scroll) {
    scroll = selectedIndex
  }
  if (selectedIndex >= scroll + maxItems) {
    scroll = selectedIndex - maxItems + 1
  }
  return scroll
}

// --- Key detection ---

/**
 * Check whether the input is a printable character (no escape sequences, code point >= 32).
 */
export function isPrintableInput(data: string): boolean {
  if (data.length === 0 || data.includes("\x1b")) {
    return false
  }
  return [...data].every((char) => {
    const codePoint = char.codePointAt(0)
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
  })
}

/**
 * Check whether the input represents an Enter/Return key.
 */
export function isEnter(data: string): boolean {
  return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\r" || data === "\n"
}

/**
 * Check whether the input represents a backspace key.
 */
export function isBackspace(data: string): boolean {
  return matchesKey(data, "backspace") || data === "\b" || data === "\x7f"
}

/**
 * Check whether the input represents a PageUp key.
 */
function isPageUp(data: string): boolean {
  return matchesKey(data, "pageUp") || data === "\x1b[5~"
}

/**
 * Check whether the input represents a PageDown key.
 */
function isPageDown(data: string): boolean {
  return matchesKey(data, "pageDown") || data === "\x1b[6~"
}

// --- State class ---

export interface FilterableListCacheStats {
  readonly itemsVersion: number
  readonly filteredSnapshotBuilds: number
}

interface FilteredSnapshot<T> {
  readonly itemsVersion: number
  readonly query: string
  readonly items: readonly T[]
}

function immutableItems<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items])
}

/**
 * Generic state container for a filterable list overlay.
 * Manages search query, selection, scroll, and filtered items.
 *
 * The item array and searchable fields are treated as immutable until the
 * items setter is used. A single versioned filtered snapshot is retained, so
 * replacing items or changing the query has explicit, bounded invalidation.
 */
export class FilterableListState<T> {
  public selectedIndex = 0
  public scroll = 0

  private itemsSnapshot: readonly T[]
  private itemsVersion = 0
  private currentSearchQuery = ""
  private filteredSnapshot: FilteredSnapshot<T> | undefined
  private filteredSnapshotBuilds = 0

  constructor(
    items: readonly T[],
    /** Function that produces a searchable string for each item. */
    private readonly searchText: (item: T) => string,
  ) {
    this.itemsSnapshot = immutableItems(items)
  }

  /** Full immutable list snapshot (before filtering). */
  get items(): readonly T[] {
    return this.itemsSnapshot
  }

  set items(items: readonly T[]) {
    this.itemsSnapshot = immutableItems(items)
    this.itemsVersion++
    this.filteredSnapshot = undefined
  }

  get searchQuery(): string {
    return this.currentSearchQuery
  }

  set searchQuery(query: string) {
    if (query === this.currentSearchQuery) {
      return
    }
    this.currentSearchQuery = query
    this.filteredSnapshot = undefined
  }

  /** Items filtered by the current search query. */
  get filteredItems(): readonly T[] {
    const cached = this.filteredSnapshot
    if (cached?.itemsVersion === this.itemsVersion && cached.query === this.searchQuery) {
      return cached.items
    }

    const tokens = searchTokens(this.searchQuery)
    const items =
      tokens.length === 0
        ? this.itemsSnapshot
        : Object.freeze(this.itemsSnapshot.filter((item) => matchesSearch(this.searchText(item), tokens)))
    this.filteredSnapshot = Object.freeze({ itemsVersion: this.itemsVersion, query: this.searchQuery, items })
    this.filteredSnapshotBuilds++
    return items
  }

  /** Total count of filtered items. */
  get filteredCount(): number {
    return this.filteredItems.length
  }

  /** Get the filtered item at the given index. */
  get(index: number): T | undefined {
    return this.filteredItems[index]
  }

  public cacheStats(): FilterableListCacheStats {
    return { itemsVersion: this.itemsVersion, filteredSnapshotBuilds: this.filteredSnapshotBuilds }
  }

  /** Reset selection and scroll to the beginning. */
  public reset(): void {
    this.selectedIndex = 0
    this.scroll = 0
  }

  /** Clamp the selection index to the valid range. */
  public clampSelection(): void {
    const itemCount = this.filteredItems.length
    this.selectedIndex = Math.max(0, Math.min(Math.max(0, itemCount - 1), this.selectedIndex))
  }

  /** Append a printable character to the search query and reset scroll. */
  public appendSearchChar(char: string): void {
    this.searchQuery += char
    this.reset()
  }

  /** Remove the last character from the search query and reset scroll. */
  public backspaceSearch(): void {
    this.searchQuery = [...this.searchQuery].slice(0, -1).join("")
    this.reset()
  }

  /** Move selection with a navigation key. Returns true if handled. */
  public moveSelection(data: string): boolean {
    const nextIndex = nextListSelectionIndex(data, this.selectedIndex, this.filteredItems.length)
    if (nextIndex === undefined) {
      return false
    }
    this.selectedIndex = nextIndex
    return true
  }

  /** Get visible items after applying scroll. */
  public visibleItems(maxItems: number): Array<{ item: T; index: number }> {
    const filteredItems = this.filteredItems
    this.scroll = nextListScroll(this.selectedIndex, this.scroll, filteredItems.length, maxItems)
    const end = Math.min(filteredItems.length, this.scroll + maxItems)
    const result: Array<{ item: T; index: number }> = []
    for (let i = this.scroll; i < end; i++) {
      const item = filteredItems[i]
      if (item !== undefined) {
        result.push({ item, index: i })
      }
    }
    return result
  }
}
