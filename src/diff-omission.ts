import type { DiffFile, DiffOmission, DiffOmissionReason } from "./types.js"

export interface DiffOmissionDetails {
  readonly measuredBytes?: number
  readonly limitBytes?: number
  readonly measuredLines?: number
  readonly limitLines?: number
  readonly limitFiles?: number
  readonly detail?: string
}

export interface OmittedDiffFileOptions extends DiffOmissionDetails {
  readonly path: string
  readonly reason: DiffOmissionReason
  readonly status: DiffFile["status"]
  readonly staged: boolean
  readonly oldPath?: string
  readonly newPath?: string
  readonly untracked?: boolean
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  let unit = units[0] ?? "KiB"
  for (const next of units.slice(1)) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

function byteBudgetMessage(details: DiffOmissionDetails, fallback: string): string {
  if (details.measuredBytes !== undefined && details.limitBytes !== undefined) {
    return `${formatByteCount(details.measuredBytes)} exceeds the ${formatByteCount(details.limitBytes)} limit.`
  }
  if (details.limitBytes !== undefined) {
    return `${fallback} The limit is ${formatByteCount(details.limitBytes)}.`
  }
  return fallback
}

function omissionMessage(reason: DiffOmissionReason, details: DiffOmissionDetails): string {
  if (details.detail) {
    return details.detail
  }
  switch (reason) {
    case "file-too-large":
      return byteBudgetMessage(details, "The source file is too large to capture safely.")
    case "file-count-budget":
      return `The ${details.limitFiles ?? 0}-file capture limit was reached.`
    case "aggregate-byte-budget":
      return byteBudgetMessage(details, "The aggregate source-byte budget was reached.")
    case "aggregate-line-budget":
      if (details.measuredLines !== undefined && details.limitLines !== undefined) {
        return `${details.measuredLines} patch lines exceed the ${details.limitLines}-line limit.`
      }
      return details.limitLines === undefined
        ? "The retained patch line budget was reached."
        : `The retained patch exceeds the ${details.limitLines}-line limit.`
    case "unsupported-file":
      return "This path is not a supported regular file or symbolic link."
    case "changed-during-load":
      return "The path changed while the diff was loading; reload to try again."
    case "capture-overflow":
      return byteBudgetMessage(details, "The complete patch did not fit in the retained-output budget.")
  }
}

export function createDiffOmission(reason: DiffOmissionReason, details: DiffOmissionDetails = {}): DiffOmission {
  return {
    reason,
    ...(details.measuredBytes === undefined ? {} : { measuredBytes: details.measuredBytes }),
    ...(details.limitBytes === undefined ? {} : { limitBytes: details.limitBytes }),
    ...(details.measuredLines === undefined ? {} : { measuredLines: details.measuredLines }),
    ...(details.limitLines === undefined ? {} : { limitLines: details.limitLines }),
    ...(details.limitFiles === undefined ? {} : { limitFiles: details.limitFiles }),
    message: omissionMessage(reason, details),
  }
}

export function omittedDiffFile(options: OmittedDiffFileOptions): DiffFile {
  return {
    path: options.path,
    ...(options.oldPath === undefined ? {} : { oldPath: options.oldPath }),
    ...(options.newPath === undefined ? {} : { newPath: options.newPath }),
    status: options.status,
    staged: options.staged,
    ...(options.untracked ? { untracked: true } : {}),
    lines: [],
    omission: createDiffOmission(options.reason, options),
  }
}
