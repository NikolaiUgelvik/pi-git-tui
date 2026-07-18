import { type FilterableListState } from "./filterable-list-state.js";
export declare function isEscapeInput(data: string): boolean;
export interface FilterableListInputOptions<T> {
    state: "closed" | "loading" | "open";
    list: FilterableListState<T>;
    onEnter: (item: T) => void;
    onClose: () => void;
    onRequestRender: () => void;
}
export declare function handleFilterableListControllerInput<T>(data: string, options: FilterableListInputOptions<T>): void;
export declare function resetFilterableList<T>(list: FilterableListState<T>, onRequestRender: () => void): void;
export declare function handleFilterableListInput<T>(data: string, list: FilterableListState<T>, onEnter: (item: T) => void): boolean;
