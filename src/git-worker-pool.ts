import { throwIfGitAborted } from "./git-service.js"

export interface LinkedAbortController {
  readonly controller: AbortController
  readonly dispose: () => void
}

export function linkedAbortController(parent?: AbortSignal): LinkedAbortController {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (parent?.aborted) {
    controller.abort()
  } else {
    parent?.addEventListener("abort", abort, { once: true })
  }
  return {
    controller,
    dispose: () => parent?.removeEventListener("abort", abort),
  }
}

export async function mapGitWorkers<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  parentSignal?: AbortSignal,
): Promise<R[]> {
  const linked = linkedAbortController(parentSignal)
  const signal = linked.controller.signal
  const results = new Array<R>(items.length)
  let cursor = 0
  let firstFailure: unknown

  const runWorker = async (): Promise<void> => {
    while (true) {
      throwIfGitAborted(signal)
      const index = cursor++
      const item = items[index]
      if (item === undefined) {
        return
      }
      try {
        results[index] = await task(item, index, signal)
      } catch (error) {
        firstFailure ??= error
        linked.controller.abort()
        return
      }
    }
  }

  try {
    throwIfGitAborted(signal)
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
    await Promise.allSettled(Array.from({ length: workerCount }, runWorker))
    if (firstFailure !== undefined) {
      throw firstFailure
    }
    throwIfGitAborted(signal)
    return results
  } finally {
    linked.dispose()
  }
}
