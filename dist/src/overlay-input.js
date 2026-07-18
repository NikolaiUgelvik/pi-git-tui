import { matchesKey } from "@earendil-works/pi-tui";
import { isBackspace, isEnter, isPrintableInput } from "./filterable-list-state.js";
export function isCancelInput(data) {
    return matchesKey(data, "escape") || data === "q" || data === "Q";
}
export function isEscapeInput(data) {
    return matchesKey(data, "escape");
}
export function resetFilterableList(list, onRequestRender) {
    list.reset();
    list.clampSelection();
    onRequestRender();
}
export function handleFilterableListInput(data, list, onEnter) {
    if (isBackspace(data)) {
        list.backspaceSearch();
        return true;
    }
    if (isPrintableInput(data)) {
        list.appendSearchChar(data);
        return true;
    }
    if (list.moveSelection(data)) {
        return true;
    }
    if (isEnter(data)) {
        const item = list.get(list.selectedIndex);
        if (item !== undefined) {
            onEnter(item);
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=overlay-input.js.map