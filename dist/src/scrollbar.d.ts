export interface ScrollbarOptions {
    width: number;
    viewportHeight: number;
    contentHeight: number;
    scrollOffset: number;
    theme: {
        fg(color: string, text: string): string;
    };
    minWidth?: number;
}
export declare function renderScrollbar(lines: string[], options: ScrollbarOptions): string[];
