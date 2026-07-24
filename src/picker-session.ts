export type PickerRequest = {
  readonly generation: number
}

export class PickerSession<S extends string> {
  private generation = 0
  private phase: "closed" | "loading" | S = "closed"
  private message: string | undefined
  private returnState: "closed" | S = "closed"

  get state(): "closed" | "loading" | S {
    return this.phase
  }

  get loadingMessage(): string | undefined {
    return this.message
  }

  transition(state: S | "closed"): void {
    this.phase = state
    this.message = undefined
  }

  beginLoading(message: string, returnState: S | "closed"): PickerRequest {
    this.generation += 1
    this.phase = "loading"
    this.message = message
    this.returnState = returnState
    return { generation: this.generation }
  }

  isCurrent(request: PickerRequest): boolean {
    return request.generation === this.generation
  }

  finish(request: PickerRequest, state: S | "closed"): boolean {
    if (!this.isCurrent(request)) return false
    this.phase = state
    this.message = undefined
    return true
  }

  cancelLoading(): S | "closed" {
    const state = this.returnState
    this.generation += 1
    this.phase = state
    this.message = undefined
    return state
  }

  updateLoadingMessage(message: string): void {
    if (this.phase !== "loading") return
    this.message = message
  }

  close(): { readonly wasLoading: boolean } {
    const wasLoading = this.phase === "loading"
    this.generation += 1
    this.phase = "closed"
    this.message = undefined
    return { wasLoading }
  }
}
