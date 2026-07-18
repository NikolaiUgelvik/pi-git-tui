import { matchesKey } from "@earendil-works/pi-tui";
import { arrowScrollDelta, isPageDownInput, isPageUpInput } from "./viewer-key-input.js";
export class HelpOverlayState {
    _context;
    _offset = 0;
    pageRows = 1;
    totalRows = 0;
    get context() {
        return this._context;
    }
    get offset() {
        return this._offset;
    }
    open(context) {
        if (this._context !== context) {
            this._offset = 0;
        }
        this._context = context;
    }
    close() {
        this._context = undefined;
        this._offset = 0;
    }
    configure(context, totalRows, pageRows) {
        if (this._context !== context) {
            this._context = context;
            this._offset = 0;
        }
        this.totalRows = Math.max(0, totalRows);
        this.pageRows = Math.max(1, pageRows);
        this.clamp();
    }
    visibleRange() {
        return { start: this._offset, end: Math.min(this.totalRows, this._offset + this.pageRows) };
    }
    rangeLabel() {
        if (this.totalRows === 0) {
            return "0/0";
        }
        const range = this.visibleRange();
        return `${range.start + 1}–${range.end}/${this.totalRows}`;
    }
    handleNavigation(data) {
        const delta = arrowScrollDelta(data);
        if (delta !== 0) {
            this._offset += delta;
            this.clamp();
            return true;
        }
        if (isPageUpInput(data)) {
            this._offset -= this.pageRows;
            this.clamp();
            return true;
        }
        if (isPageDownInput(data)) {
            this._offset += this.pageRows;
            this.clamp();
            return true;
        }
        if (matchesKey(data, "home")) {
            this._offset = 0;
            return true;
        }
        if (matchesKey(data, "end")) {
            this._offset = this.maximumOffset();
            return true;
        }
        return false;
    }
    maximumOffset() {
        return Math.max(0, this.totalRows - this.pageRows);
    }
    clamp() {
        this._offset = Math.max(0, Math.min(this.maximumOffset(), this._offset));
    }
}
//# sourceMappingURL=help-overlay-state.js.map