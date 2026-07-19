import { visibleWidth } from "@earendil-works/pi-tui";
import { fit } from "./render-text.js";
import { isViewerActionAvailable } from "./viewer-action-policy.js";
function availableActions(context, actions) {
    return actions
        .filter((item) => item.visible !== false)
        .filter((item) => item.action === undefined || isViewerActionAvailable(context.document, item.action))
        .map((item) => item.label);
}
function helpFirst(controls) {
    const helpIndex = controls.indexOf("? help");
    if (helpIndex <= 0) {
        return controls;
    }
    return [controls[helpIndex] ?? "? help", ...controls.slice(0, helpIndex), ...controls.slice(helpIndex + 1)];
}
export function prioritizedFooter(summary, controls, width) {
    const ordered = helpFirst(controls);
    if (!summary) {
        return fit(ordered.join(" • "), width);
    }
    const [first, ...remaining] = ordered;
    const prefix = first ? `${first} • ` : "";
    const suffix = remaining.length > 0 ? ` • ${remaining.join(" • ")}` : "";
    const summaryWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
    if (summaryWidth === 0) {
        return fit(ordered.join(" • "), width);
    }
    return `${prefix}${fit(summary, summaryWidth)}${suffix}`;
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
    const activeFiles = context.document.mode === "working" ? context.document[context.workingTreeView].files : context.document.diff.files;
    const hasFiles = activeFiles.length > 0;
    const historical = context.document.mode === "commit";
    const indexAction = workingView ? "stage remaining" : "unstage";
    const contextual = [
        { label: "? help", action: "help" },
        { label: "q close", action: "close" },
        { label: "W tree", action: "workingTree" },
        {
            label: `Tab ${treeFocused ? "diff" : "files"}`,
            action: "navigate",
            visible: hasFiles,
        },
        {
            label: treeFocused ? "↑↓/j/k files" : "↑↓/j/k scroll",
            action: "navigate",
            visible: hasFiles,
        },
        {
            label: `Enter ${indexAction}`,
            action: "stageFile",
            visible: hasFiles && treeFocused,
        },
        {
            label: "D discard",
            action: "discard",
            visible: hasFiles && treeFocused && workingView,
        },
        {
            label: "←→ columns",
            action: "navigate",
            visible: hasFiles && !treeFocused,
        },
        {
            label: "C commit",
            action: "commit",
            visible: hasFiles && !workingView,
        },
        {
            label: workingView ? "v staged" : "v working",
            action: "toggleView",
        },
        {
            label: "c commits",
            action: "commitPicker",
            visible: !hasFiles || historical,
        },
    ];
    return fitActions(availableActions(context, contextual), width);
}
//# sourceMappingURL=viewer-footer-actions.js.map