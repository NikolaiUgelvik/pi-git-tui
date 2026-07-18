import type { DiffFile } from "./types.js";
export type DiffDisplayRow = {
    type: "hunk";
    sectionText?: string;
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
} | {
    type: "context";
    marker: " ";
    lineNumber: number;
    text: string;
} | {
    type: "addition";
    marker: "+";
    lineNumber: number;
    text: string;
} | {
    type: "deletion";
    marker: "-";
    lineNumber: number;
    text: string;
} | {
    type: "summary";
    text: string;
} | {
    type: "unknown";
    text: string;
};
export declare function formatDiffDisplay(file: DiffFile): DiffDisplayRow[];
