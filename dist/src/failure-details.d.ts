export interface FailureDetails {
    summary: string;
    details: string;
    cause: unknown;
}
export declare function failureDetails(error: unknown, fallbackSummary: string): FailureDetails;
