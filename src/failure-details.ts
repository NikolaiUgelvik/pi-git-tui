export interface FailureDetails {
  summary: string
  details: string
  cause: unknown
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function explicitDetails(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("details" in error)) {
    return
  }
  return typeof error.details === "string" && error.details.trim() ? error.details : undefined
}

export function failureDetails(error: unknown, fallbackSummary: string): FailureDetails {
  const message = errorMessage(error).trim()
  const summary = message.split("\n").find(Boolean) ?? fallbackSummary
  const details =
    explicitDetails(error) ?? (error instanceof Error ? error.stack : undefined) ?? message ?? fallbackSummary
  return { summary, details, cause: error }
}
