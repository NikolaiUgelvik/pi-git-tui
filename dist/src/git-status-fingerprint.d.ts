import type { SnapshotHeadState, StatusEntry } from "./git-status.js";
export interface StatusFingerprintInput {
    readonly head: SnapshotHeadState;
    readonly entries: readonly StatusEntry[];
    readonly untrackedPaths: readonly string[];
}
export declare function isWorkingTreeSnapshotClean(snapshot: StatusFingerprintInput): boolean;
export declare function workingTreeStatusFingerprint(snapshot: StatusFingerprintInput): string;
