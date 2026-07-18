import type { ThemeColor } from "./types.js";
export interface DiffLineStyleRule {
    matches: (line: string) => boolean;
    color: ThemeColor;
    bold?: boolean;
}
export declare function diffLineStyleForText(line: string): DiffLineStyleRule | undefined;
