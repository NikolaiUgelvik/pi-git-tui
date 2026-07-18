import { matchesKey } from "@earendil-works/pi-tui"
import { type FilterableListState, isEnter } from "./filterable-list-state.js"

export function isEscapeInput(data: string): boolean {
  return matchesKey(data, "escape")
}

export interface FilterableListInputOptions<T> {
  state: "closed" | "loading" | "open"
  list: FilterableListState<T>
  onEnter: (item: T) => void
  onClose: () => void
  onRequestRender: () => void
}

export function handleFilterableListControllerInput<T>(data: string, options: FilterableListInputOptions<T>): void {
  if (options.state === "loading") {
    return
  }
  if (isEscapeInput(data)) {
    options.onClose()
    return
  }
  handleFilterableListInput(data, options.list, options.onEnter)
  options.list.clampSelection()
  options.onRequestRender()
}

export function resetFilterableList<T>(list: FilterableListState<T>, onRequestRender: () => void): void {
  list.reset()
  list.clampSelection()
  onRequestRender()
}

export function handleFilterableListInput<T>(
  data: string,
  list: FilterableListState<T>,
  onEnter: (item: T) => void,
): boolean {
  if (list.handleSearchInput(data)) {
    return true
  }
  if (list.moveSelection(data)) {
    return true
  }
  if (isEnter(data)) {
    const item = list.get(list.selectedIndex)
    if (item !== undefined) {
      onEnter(item)
    }
    return true
  }
  return false
}
