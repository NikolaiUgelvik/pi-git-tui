import { matchesKey } from "@earendil-works/pi-tui"
import { type FilterableListState, isBackspace, isEnter, isPrintableInput } from "./filterable-list-state.js"

export function isCancelInput(data: string): boolean {
  return matchesKey(data, "escape") || data === "q" || data === "Q"
}

export function isEscapeInput(data: string): boolean {
  return matchesKey(data, "escape")
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
  if (isBackspace(data)) {
    list.backspaceSearch()
    return true
  }
  if (isPrintableInput(data)) {
    list.appendSearchChar(data)
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
