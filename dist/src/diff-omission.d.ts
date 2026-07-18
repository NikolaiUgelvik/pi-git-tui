import type { DiffFile, DiffOmission, DiffOmissionReason } from "./types.js";
export interface DiffOmissionDetails {
    readonly measuredBytes?: number;
    readonly limitBytes?: number;
    readonly measuredLines?: number;
    readonly limitLines?: number;
    readonly limitFiles?: number;
    readonly detail?: string;
}
export interface OmittedDiffFileOptions extends DiffOmissionDetails {
    readonly path: string;
    readonly reason: DiffOmissionReason;
    readonly status: DiffFile["status"];
    readonly staged: boolean;
    readonly oldPath?: string;
    readonly newPath?: string;
    readonly untracked?: boolean;
}
export declare function createDiffOmission(reason: DiffOmissionReason, details?: DiffOmissionDetails): DiffOmission;
export declare function omittedDiffFile(options: OmittedDiffFileOptions): DiffFile;
