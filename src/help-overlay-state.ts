import { matchesKey } from "@earendil-works/pi-tui"
import type { HelpContext } from "./types.js"
import { arrowScrollDelta, isPageDownInput, isPageUpInput } from "./viewer-key-input.js"

export class HelpOverlayState {
  private _context: HelpContext | undefined
  private _offset = 0
  private pageRows = 1
  private totalRows = 0

  get context(): HelpContext | undefined {
    return this._context
  }

  get offset(): number {
    return this._offset
  }

  open(context: HelpContext): void {
    if (this._context !== context) {
      this._offset = 0
    }
    this._context = context
  }

  close(): void {
    this._context = undefined
    this._offset = 0
  }

  configure(context: HelpContext, totalRows: number, pageRows: number): void {
    if (this._context !== context) {
      this._context = context
      this._offset = 0
    }
    this.totalRows = Math.max(0, totalRows)
    this.pageRows = Math.max(1, pageRows)
    this.clamp()
  }

  visibleRange(): { start: number; end: number } {
    return { start: this._offset, end: Math.min(this.totalRows, this._offset + this.pageRows) }
  }

  rangeLabel(): string {
    if (this.totalRows === 0) {
      return "0/0"
    }
    const range = this.visibleRange()
    return `${range.start + 1}–${range.end}/${this.totalRows}`
  }

  handleNavigation(data: string): boolean {
    const delta = arrowScrollDelta(data)
    if (delta !== 0) {
      this._offset += delta
      this.clamp()
      return true
    }
    if (isPageUpInput(data)) {
      this._offset -= this.pageRows
      this.clamp()
      return true
    }
    if (isPageDownInput(data)) {
      this._offset += this.pageRows
      this.clamp()
      return true
    }
    if (matchesKey(data, "home")) {
      this._offset = 0
      return true
    }
    if (matchesKey(data, "end")) {
      this._offset = this.maximumOffset()
      return true
    }
    return false
  }

  private maximumOffset(): number {
    return Math.max(0, this.totalRows - this.pageRows)
  }

  private clamp(): void {
    this._offset = Math.max(0, Math.min(this.maximumOffset(), this._offset))
  }
}
