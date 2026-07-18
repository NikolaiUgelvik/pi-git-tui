export type ViewerMutationKind =
  | "stage-file"
  | "stage-all"
  | "commit"
  | "initialize"
  | "discard"
  | "branch-switch"
  | "branch-create"
  | "stash"
  | "command"

export type MutationRun<T> = { accepted: false } | { accepted: true; value: T }

export type DocumentLoadDisposition = "applied" | "superseded"

export type ViewerOperationEvent =
  | {
      type: "mutation-started" | "mutation-rejected" | "mutation-finished"
      kind: ViewerMutationKind
    }
  | {
      type: "load-started" | "load-applied" | "load-superseded"
      generation: number
      target: string
    }

export type ViewerOperationObserver = (event: ViewerOperationEvent) => void

export interface ViewerOperationCoordinatorOptions {
  readonly signal?: AbortSignal
  readonly onEvent?: ViewerOperationObserver
}

interface LinkedController {
  readonly controller: AbortController
  dispose(): void
}

function linkedController(...inputs: Array<AbortSignal | undefined>): LinkedController {
  const controller = new AbortController()
  const parents = [...new Set(inputs.filter((signal): signal is AbortSignal => signal !== undefined))]
  const abort = () => controller.abort(parents.find((signal) => signal.aborted)?.reason)
  if (parents.some((signal) => signal.aborted)) {
    abort()
  } else {
    for (const parent of parents) parent.addEventListener("abort", abort, { once: true })
  }
  return {
    controller,
    dispose: () => {
      for (const parent of parents) parent.removeEventListener("abort", abort)
    },
  }
}

export class ViewerOperationCoordinator {
  private readonly parentSignal: AbortSignal | undefined
  private readonly observer: ViewerOperationObserver | undefined
  private readonly abortFromParent = () => this.dispose()
  private activeMutation: LinkedController | undefined
  private activeLoad: LinkedController | undefined
  private nextGeneration = 0
  private latestGeneration = 0
  private disposed = false

  constructor(options: ViewerOperationCoordinatorOptions = {}) {
    this.parentSignal = options.signal
    this.observer = options.onEvent
    if (this.parentSignal?.aborted) {
      this.disposed = true
    } else {
      this.parentSignal?.addEventListener("abort", this.abortFromParent, { once: true })
    }
  }

  get mutationActive(): boolean {
    return this.activeMutation !== undefined
  }

  async runMutation<T>(kind: ViewerMutationKind, task: (signal: AbortSignal) => Promise<T>): Promise<MutationRun<T>> {
    if (this.disposed || this.activeMutation) {
      this.emit({ type: "mutation-rejected", kind })
      return { accepted: false }
    }

    this.latestGeneration = ++this.nextGeneration
    this.abortActiveLoad()
    const linked = linkedController(this.parentSignal)
    this.activeMutation = linked
    this.emit({ type: "mutation-started", kind })
    try {
      return { accepted: true, value: await task(linked.controller.signal) }
    } finally {
      linked.dispose()
      if (this.activeMutation === linked) {
        this.activeMutation = undefined
      }
      this.emit({ type: "mutation-finished", kind })
    }
  }

  async applyLatest<T>(
    target: string,
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
    ownerSignal?: AbortSignal,
  ): Promise<DocumentLoadDisposition> {
    const generation = ++this.nextGeneration
    this.emit({ type: "load-started", generation, target })
    if (
      this.disposed ||
      ownerSignal?.aborted ||
      (this.activeMutation !== undefined && ownerSignal !== this.activeMutation.controller.signal)
    ) {
      this.emit({ type: "load-superseded", generation, target })
      return "superseded"
    }

    this.latestGeneration = generation
    this.abortActiveLoad()
    const linked = linkedController(this.parentSignal, ownerSignal)
    this.activeLoad = linked
    try {
      const value = await load(linked.controller.signal)
      if (this.isSuperseded(generation, linked)) {
        this.emit({ type: "load-superseded", generation, target })
        return "superseded"
      }
      apply(value)
      this.emit({ type: "load-applied", generation, target })
      return "applied"
    } catch (error) {
      if (this.isSuperseded(generation, linked)) {
        this.emit({ type: "load-superseded", generation, target })
        return "superseded"
      }
      throw error
    } finally {
      linked.dispose()
      if (this.activeLoad === linked) {
        this.activeLoad = undefined
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.parentSignal?.removeEventListener("abort", this.abortFromParent)
    this.activeMutation?.controller.abort()
    this.abortActiveLoad()
  }

  private isSuperseded(generation: number, linked: LinkedController): boolean {
    return this.disposed || generation !== this.latestGeneration || linked.controller.signal.aborted
  }

  private abortActiveLoad(): void {
    this.activeLoad?.controller.abort()
    this.activeLoad?.dispose()
    this.activeLoad = undefined
  }

  private emit(event: ViewerOperationEvent): void {
    try {
      this.observer?.(event)
    } catch {
      // Instrumentation must not affect viewer behavior.
    }
  }
}
