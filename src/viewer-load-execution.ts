import { failureDetails } from "./failure-details.js"
import type { ActiveOperation, OperationExecutionRuntime } from "./viewer-operation-runtime.js"
import type { LoadOutcome, LoadSpec } from "./viewer-operation-types.js"

export async function executeLoad<T>(
  runtime: OperationExecutionRuntime,
  active: ActiveOperation,
  spec: LoadSpec<T>,
): Promise<LoadOutcome<T>> {
  try {
    const value = await spec.load(runtime.executionContext(active))
    if (runtime.completionIsStale(active)) {
      runtime.finish(active, { state: "idle", summary: "Ignored a stale load result", canRetryRefresh: false })
      return { kind: "stale", token: active.token }
    }
    if (active.cancelRequested) {
      runtime.finish(active, { state: "idle", summary: `${spec.label} cancelled`, canRetryRefresh: false })
      return { kind: "cancelled", token: active.token }
    }
    spec.apply(value, active.token)
    const successMessage = spec.successMessage?.(value)
    runtime.finish(
      active,
      successMessage
        ? { state: "succeeded", label: spec.label, summary: successMessage, successMessage, canRetryRefresh: false }
        : { state: "idle", canRetryRefresh: false },
    )
    return { kind: "succeeded", value, token: active.token }
  } catch (error) {
    if (runtime.completionIsStale(active)) {
      runtime.finish(active, { state: "idle", summary: "Ignored a stale load failure", canRetryRefresh: false })
      return { kind: "stale", token: active.token }
    }
    if (active.cancelRequested) {
      runtime.finish(active, { state: "idle", summary: `${spec.label} cancelled`, canRetryRefresh: false })
      return { kind: "cancelled", token: active.token }
    }
    const failure = failureDetails(error, `${spec.label} failed`)
    runtime.finish(
      active,
      spec.reportFailure === false
        ? { state: "idle", canRetryRefresh: false }
        : { state: "failed", label: spec.label, summary: failure.summary, failure, canRetryRefresh: false },
    )
    return { kind: "failed", failure, token: active.token }
  }
}
