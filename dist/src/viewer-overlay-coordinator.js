export class ViewerOverlayCoordinator {
    overlays = [];
    register(kind, adapter) {
        this.overlays.push({ kind, adapter });
    }
    active() {
        for (let index = this.overlays.length - 1; index >= 0; index -= 1) {
            const overlay = this.overlays[index];
            if (overlay?.adapter.isActive()) {
                return overlay;
            }
        }
    }
    hasActive() {
        return this.active() !== undefined;
    }
    activeTextField() {
        return this.active()?.adapter.activeTextField();
    }
    helpContext() {
        return this.active()?.adapter.helpContext();
    }
    render(baseLines, width) {
        return this.active()?.adapter.render(baseLines, width) ?? baseLines;
    }
    handleInput(data) {
        const active = this.active();
        if (!active) {
            return false;
        }
        active.adapter.handleInput(data);
        return true;
    }
    handleOpen(data) {
        for (let index = this.overlays.length - 1; index >= 0; index -= 1) {
            if (this.overlays[index]?.adapter.handleOpen(data)) {
                return true;
            }
        }
        return false;
    }
    closeActive() {
        const active = this.active();
        if (!active) {
            return false;
        }
        active.adapter.close();
        return true;
    }
}
//# sourceMappingURL=viewer-overlay-coordinator.js.map