import type { HelpContext } from "./types.js";
export declare class HelpOverlayState {
    private _context;
    private _offset;
    private pageRows;
    private totalRows;
    get context(): HelpContext | undefined;
    get offset(): number;
    open(context: HelpContext): void;
    close(): void;
    configure(context: HelpContext, totalRows: number, pageRows: number): void;
    visibleRange(): {
        start: number;
        end: number;
    };
    rangeLabel(): string;
    handleNavigation(data: string): boolean;
    private maximumOffset;
    private clamp;
}
