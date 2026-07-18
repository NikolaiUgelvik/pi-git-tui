import type { FailureDetails } from "./failure-details.js"
import { executeLoad } from "./viewer-load-execution.js"
import { executeMutation } from "./viewer-mutation-execution.js"
import type { ActiveOperation, OperationExecutionRuntime } from "./viewer-operation-runtime.js"
import type {
  LoadOutcome,
  LoadSpec,
  MutationOutcome,
  MutationSpec,
  OperationExecutionContext,
  OperationRejectionReason,
  OperationSnapshot,
  OperationToken,
  RefreshIntent,
} from "./viewer-operation-types.js"
import { executeRefreshRetry } from "./viewer-reconciliation-execution.js"
import { erasedRefreshIntent, type PendingRefresh } from "./viewer-refresh-recovery.js"

export type {
  LoadOutcome,
  LoadSpec,
  MutationOutcome,
  MutationSpec,
  OperationRejectionReason,
  OperationSnapshot,
  RefreshIntent,
} from "./viewer-operation-types.js"

export interface CoordinatorOptions {
  currentContext: () => { cwd: string; generation: number }
  onChange?: (snapshot: OperationSnapshot) => void
  parentSignal?: AbortSignal
}

export class ViewerOperationCoordinator {
  private active: ActiveOperation | undefined
  private nextOperationId = 1
  private pendingRefresh: PendingRefresh | undefined
  private readonly options: CoordinatorOptions
  private currentSnapshot: OperationSnapshot = { state: "idle", canRetryRefresh: false }

  constructor(options: CoordinatorOptions) {
    this.options = options
  }

  get snapshot(): OperationSnapshot {
    return this.currentSnapshot
  }

  isBusy(): boolean {
    return ["running", "cancelling", "reconciling"].includes(this.currentSnapshot.state)
  }

  startBlockReason(): OperationRejectionReason | undefined {
    if (this.active) {
      return "busy"
    }
    return this.pendingRefresh ? "refreshRequired" : undefined
  }

  clearSettled(): void {
    if (this.active || this.pendingRefresh) {
      return
    }
    this.setSnapshot({ state: "idle", canRetryRefresh: false })
  }

  runMutation<T, R = unknown>(spec: MutationSpec<T, R>): Promise<MutationOutcome<T>> {
    const reason = this.startBlockReason()
    if (reason) {
      return Promise.resolve({ kind: "rejected", reason })
    }
    const active = this.begin("mutation", "mutation", spec.label, spec.runningMessage)
    return executeMutation(this.executionRuntime(), active, spec)
  }

  runLoad<T>(spec: LoadSpec<T>): Promise<LoadOutcome<T>> {
    const reason = this.startBlockReason()
    if (reason) {
      return Promise.resolve({ kind: "rejected", reason })
    }
    const active = this.begin("load", "load", spec.label, spec.runningMessage)
    return executeLoad(this.executionRuntime(), active, spec)
  }

  retryRefresh(): Promise<LoadOutcome<unknown>> {
    const pending = this.pendingRefresh
    if (!pending || this.active) {
      return Promise.resolve({ kind: "rejected", reason: "busy" })
    }
    const current = this.options.currentContext()
    if (current.cwd !== pending.origin.cwd || current.generation !== pending.origin.generation) {
      this.pendingRefresh = undefined
      const token = { id: this.nextOperationId++, ...current }
      this.setSnapshot({ state: "idle", summary: "Discarded a stale refresh retry", canRetryRefresh: false })
      return Promise.resolve({ kind: "stale", token })
    }
    const active = this.begin("retry", "retry", pending.intent.label, "Retrying diff refresh…")
    return executeRefreshRetry(this.executionRuntime(), active, pending)
  }

  cancelActive(): boolean {
    const active = this.active
    if (!active || active.phase === "reconcile") {
      return false
    }
    active.cancelRequested = true
    active.controller.abort()
    this.setSnapshot({
      ...this.currentSnapshot,
      state: "cancelling",
      summary: `Cancelling ${this.currentSnapshot.label ?? "operation"}…`,
      canRetryRefresh: this.pendingRefresh !== undefined,
    })
    return true
  }

  private begin(
    kind: ActiveOperation["kind"],
    phase: ActiveOperation["phase"],
    label: string,
    summary: string,
  ): ActiveOperation {
    const context = this.options.currentContext()
    const token: OperationToken = { id: this.nextOperationId++, cwd: context.cwd, generation: context.generation }
    const controller = new AbortController()
    const parentSignal = this.options.parentSignal
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    if (parentSignal?.aborted) abortFromParent()
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true })
    const active: ActiveOperation = {
      token,
      kind,
      phase,
      controller,
      cancelRequested: false,
      disposeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent),
    }
    this.active = active
    this.setSnapshot({ state: "running", label, summary, token, canRetryRefresh: this.pendingRefresh !== undefined })
    return active
  }

  private executionContext(active: ActiveOperation): OperationExecutionContext {
    return { token: active.token, signal: active.controller.signal }
  }

  private completionIsStale(active: ActiveOperation): boolean {
    return this.active !== active || !this.tokenIsCurrent(active.token)
  }

  private tokenIsCurrent(token: OperationToken): boolean {
    const current = this.options.currentContext()
    return current.cwd === token.cwd && current.generation === token.generation
  }

  private finish(active: ActiveOperation, snapshot: OperationSnapshot): void {
    if (this.active !== active) {
      return
    }
    active.disposeParentAbort?.()
    this.active = undefined
    this.setSnapshot(snapshot)
  }

  private finishStale<T>(active: ActiveOperation, mutation?: T): MutationOutcome<T> {
    this.finish(active, { state: "idle", summary: "Ignored a stale operation result", canRetryRefresh: false })
    return { kind: "stale", mutation, token: active.token }
  }

  private storeRefreshFailure<T>(
    active: ActiveOperation,
    intent: RefreshIntent<T>,
    failure: FailureDetails,
    completion: OperationSnapshot,
    failedSummary: string,
    successMessage?: string,
  ): void {
    this.pendingRefresh = {
      intent: erasedRefreshIntent(intent),
      failedSummary,
      failure,
      origin: { cwd: active.token.cwd, generation: active.token.generation },
      successMessage,
      completion,
    }
    this.finish(active, {
      state: "refreshFailed",
      label: intent.label,
      summary: failedSummary,
      successMessage,
      failure,
      canRetryRefresh: true,
    })
  }

  private executionRuntime(): OperationExecutionRuntime {
    return {
      executionContext: (active) => this.executionContext(active),
      completionIsStale: (active) => this.completionIsStale(active),
      finish: (active, snapshot) => this.finish(active, snapshot),
      finishStale: <T>(active: ActiveOperation, mutation?: T) => this.finishStale(active, mutation),
      setSnapshot: (snapshot) => this.setSnapshot(snapshot),
      storeRefreshFailure: <T>(
        active: ActiveOperation,
        intent: RefreshIntent<T>,
        failure: FailureDetails,
        completion: OperationSnapshot,
        failedSummary: string,
        successMessage?: string,
      ) => this.storeRefreshFailure(active, intent, failure, completion, failedSummary, successMessage),
      clearPendingRefresh: () => {
        this.pendingRefresh = undefined
      },
    }
  }

  private setSnapshot(snapshot: OperationSnapshot): void {
    this.currentSnapshot = snapshot
    this.options.onChange?.(snapshot)
  }
}
