import type { SingleLineTextField } from "./single-line-text-field.js"
import type { HelpContext } from "./types.js"

export type ViewerFeatureOverlayKind = "confirmation" | "branch" | "tag" | "stash" | "worktree" | "settings"

export interface ViewerOverlayAdapter {
  isActive: () => boolean
  activeTextField: () => SingleLineTextField | undefined
  helpContext: () => HelpContext
  render: (baseLines: string[], width: number) => string[]
  handleInput: (data: string) => void
  handleOpen: (data: string) => boolean
  close: () => void
}

export interface ViewerOverlayFeature {
  readonly kind: ViewerFeatureOverlayKind
  readonly adapter: ViewerOverlayAdapter
  invalidate?(): void
}

export class ViewerOverlayCoordinator {
  private readonly overlays: ViewerOverlayFeature[] = []

  /** Later registrations have higher input, rendering, and open priority. */
  register(feature: ViewerOverlayFeature): void {
    this.overlays.push(feature)
  }

  active(): ViewerOverlayFeature | undefined {
    for (let index = this.overlays.length - 1; index >= 0; index -= 1) {
      const overlay = this.overlays[index]
      if (overlay?.adapter.isActive()) {
        return overlay
      }
    }
  }

  hasActive(): boolean {
    return this.active() !== undefined
  }

  activeTextField(): SingleLineTextField | undefined {
    return this.active()?.adapter.activeTextField()
  }

  helpContext(): HelpContext | undefined {
    return this.active()?.adapter.helpContext()
  }

  render(baseLines: string[], width: number): string[] {
    return this.active()?.adapter.render(baseLines, width) ?? baseLines
  }

  handleInput(data: string): boolean {
    const active = this.active()
    if (!active) {
      return false
    }
    active.adapter.handleInput(data)
    return true
  }

  handleOpen(data: string): boolean {
    for (let index = this.overlays.length - 1; index >= 0; index -= 1) {
      if (this.overlays[index]?.adapter.handleOpen(data)) {
        return true
      }
    }
    return false
  }

  closeActive(): boolean {
    const active = this.active()
    if (!active) {
      return false
    }
    active.adapter.close()
    return true
  }
}
