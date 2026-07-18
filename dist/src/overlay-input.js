import { matchesKey } from "@earendil-works/pi-tui";
import { isEnter } from "./filterable-list-state.js";
export function isEscapeInput(data) {
    return matchesKey(data, "escape");
}
export function handleFilterableListControllerInput(data, options) {
    if (options.state === "loading") {
        return;
    }
    if (isEscapeInput(data)) {
        options.onClose();
        return;
    }
    handleFilterableListInput(data, options.list, options.onEnter);
    options.list.clampSelection();
    options.onRequestRender();
}
export function resetFilterableList(list, onRequestRender) {
    list.reset();
    list.clampSelection();
    onRequestRender();
}
export function handleFilterableListInput(data, list, onEnter) {
    if (list.handleSearchInput(data)) {
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