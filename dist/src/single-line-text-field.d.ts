import { type Focusable } from "@earendil-works/pi-tui";
export type TextFieldRouting = "search" | "editor";
export type TextFieldCaret = "start" | "end";
/**
 * Focus-aware single-line editor built on pi-tui's grapheme-aware Input.
 * Routing policy stays here so printable keys are never mistaken for viewer
 * shortcuts while an editor owns focus.
 */
export declare class SingleLineTextField implements Focusable {
    private readonly placeholder;
    private readonly input;
    constructor(value?: string, placeholder?: string);
    get focused(): boolean;
    set focused(value: boolean);
    get value(): string;
    set value(value: string);
    setValue(value: string, caret?: TextFieldCaret): void;
    handleInput(data: string, routing: TextFieldRouting): boolean;
    render(width: number, focused?: boolean, placeholder?: string): string;
    invalidate(): void;
}
