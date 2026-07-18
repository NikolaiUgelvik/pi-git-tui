import { visibleWidth } from "@earendil-works/pi-tui";
import { fit } from "./render-text.js";
import { isViewerActionAvailable } from "./viewer-action-policy.js";
function availableActions(context, actions) {
    return actions
        .filter((item) => item.visible !== false)
        .filter((item) => item.action === undefined || isViewerActionAvailable(context.document, item.action))
        .map((item) => item.label);
}
export function prioritizedFooter(summary, controls, width) {
    const suffix = controls.join(" • ");
    if (!summary) {
        return fit(suffix, width);
    }
    const separator = suffix ? " • " : "";
    const summaryWidth = Math.max(0, width - visibleWidth(separator) - visibleWidth(suffix));
    if (summaryWidth === 0) {
        return fit(suffix, width);
    }
    return `${fit(summary, summaryWidth)}${separator}${suffix}`;
}
function fitActions(actions, width) {
    const selected = [];
    for (const action of actions) {
        const candidate = [...selected, action].join(" • ");
        if (visibleWidth(candidate) <= width) {
            selected.push(action);
        }
    }
    return selected;
}
export function viewerFooterActions(context, width) {
    const treeFocused = context.focusedPanel === "tree";
    const workingView = context.workingTreeView === "working";
    const indexAction = workingView ? "stage remaining" : "unstage";
    const allAction = workingView ? "stage all remaining" : "unstage all";
    const contextualEscape = [
        { label: "W working tree", action: "workingTree" },
        { label: "v staged/working", action: "toggleView" },
    ];
    const essential = [
        ...contextualEscape,
        { label: "? help", action: "help" },
        { label: "q close", action: "close" },
    ];
    const primary = [
        { label: `${context.totals}focus:${treeFocused ? "files" : "diff"}` },
        { label: `Enter ${indexAction}`, action: "stageFile", visible: treeFocused },
        { label: `Shift+Enter ${allAction}`, action: "stageAll", visible: treeFocused },
        { label: "D discard", action: "discard", visible: treeFocused },
        { label: workingView ? "C staged review" : "C commit", action: "commit" },
        { label: "c commits", action: "commitPicker" },
    ];
    const secondary = [
        { label: "tab switch", action: "navigate" },
        { label: "n/p files", action: "navigate" },
        { label: treeFocused ? "↑↓/j/k files" : "↑↓/j/k code", action: "navigate" },
        { label: "←→/Shift+←→ columns", action: "navigate", visible: !treeFocused },
        { label: "PgUp/PgDn scroll", action: "navigate" },
        { label: "Home/End jump", action: "navigate" },
        { label: "r reload", action: "reload" },
        { label: "b branches", action: "branches" },
        { label: "w worktrees", action: "worktrees" },
        { label: "s stash", action: "stashes" },
        { label: "^P commands", action: "commands" },
    ];
    return fitActions(availableActions(context, [...essential, ...primary, ...secondary]), width);
}
//# sourceMappingURL=viewer-footer-actions.js.map