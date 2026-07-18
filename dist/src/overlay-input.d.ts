import { type FilterableListState } from "./filterable-list-state.js";
export declare function isCancelInput(data: string): boolean;
export declare function isEscapeInput(data: string): boolean;
export declare function resetFilterableList<T>(list: FilterableListState<T>, onRequestRender: () => void): void;
export declare function handleFilterableListInput<T>(data: string, list: FilterableListState<T>, onEnter: (item: T) => void): boolean;
