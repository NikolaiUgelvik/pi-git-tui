export class PickerSession {
    generation = 0;
    phase = "closed";
    message;
    returnState = "closed";
    get state() {
        return this.phase;
    }
    get loadingMessage() {
        return this.message;
    }
    transition(state) {
        this.phase = state;
        this.message = undefined;
    }
    beginLoading(message, returnState) {
        this.generation += 1;
        this.phase = "loading";
        this.message = message;
        this.returnState = returnState;
        return { generation: this.generation };
    }
    isCurrent(request) {
        return request.generation === this.generation;
    }
    finish(request, state) {
        if (!this.isCurrent(request))
            return false;
        this.phase = state;
        this.message = undefined;
        return true;
    }
    cancelLoading() {
        const state = this.returnState;
        this.generation += 1;
        this.phase = state;
        this.message = undefined;
        return state;
    }
    updateLoadingMessage(message) {
        if (this.phase !== "loading")
            return;
        this.message = message;
    }
    close() {
        const wasLoading = this.phase === "loading";
        this.generation += 1;
        this.phase = "closed";
        this.message = undefined;
        return { wasLoading };
    }
}
//# sourceMappingURL=picker-session.js.map