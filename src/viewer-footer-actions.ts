import { visibleWidth } from "@earendil-works/pi-tui"
import { fit } from "./render-text.js"
import type { DiffDocument, FocusPanel, WorkingTreeView } from "./types.js"
import { isViewerActionAvailable, type ViewerAction } from "./viewer-action-policy.js"

interface FooterAction {
  label: string
  action: ViewerAction
}

export interface ViewerFooterContext {
  document: DiffDocument
  focusedPanel: FocusPanel
  workingTreeView: WorkingTreeView
}

function availableActions(context: ViewerFooterContext, actions: FooterAction[]): string[] {
  return actions.filter((item) => isViewerActionAvailable(context.document, item.action)).map((item) => item.label)
}

const MAX_FOOTER_CONTROLS = 3

function helpFirst(controls: string[]): string[] {
  const helpIndex = controls.indexOf("? help")
  if (helpIndex <= 0) {
    return controls
  }
  return [controls[helpIndex] ?? "? help", ...controls.slice(0, helpIndex), ...controls.slice(helpIndex + 1)]
}

function conciseControls(controls: string[]): string[] {
  const ordered = helpFirst(controls)
  if (ordered.length <= MAX_FOOTER_CONTROLS) {
    return ordered
  }
  const close = ordered.find((control) => control === "q close")
  const prioritized = ordered.filter((control) => control !== close)
  return close ? [...prioritized.slice(0, MAX_FOOTER_CONTROLS - 1), close] : prioritized.slice(0, MAX_FOOTER_CONTROLS)
}

function fitFooterControls(controls: string[], width: number): string[] {
  const [first, ...remaining] = controls
  const close = remaining.find((control) => control === "q close")
  const contextual = remaining.filter((control) => control !== close)
  const priority = [...(first ? [first] : []), ...(close ? [close] : []), ...contextual]
  const selected = new Set(fitActions(priority, width))
  return controls.filter((control) => selected.has(control))
}

export function prioritizedFooter(summary: string, controls: string[], width: number): string {
  const ordered = fitFooterControls(conciseControls(controls), width)
  if (!summary) {
    return fit(ordered.join(" • "), width)
  }
  const [first, ...remaining] = ordered
  const prefix = first ? `${first} • ` : ""
  const suffix = remaining.length > 0 ? ` • ${remaining.join(" • ")}` : ""
  const summaryWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix))
  if (summaryWidth === 0) {
    return fit(ordered.join(" • "), width)
  }
  return `${prefix}${fit(summary, summaryWidth)}${suffix}`
}

function fitActions(actions: string[], width: number): string[] {
  const selected: string[] = []
  for (const action of actions) {
    const candidate = [...selected, action].join(" • ")
    if (visibleWidth(candidate) <= width) {
      selected.push(action)
    }
  }
  return selected
}

function contextualActions(context: ViewerFooterContext, hasFiles: boolean): FooterAction[] {
  const treeFocused = context.focusedPanel === "tree"
  if (context.document.mode === "commit") {
    return [
      { label: "W tree", action: "workingTree" },
      treeFocused || !hasFiles
        ? { label: "c commits", action: "commitPicker" }
        : { label: "↑↓ scroll", action: "navigate" },
    ]
  }

  const workingView = context.workingTreeView === "working"
  if (!hasFiles) {
    return [
      { label: workingView ? "v staged" : "v working", action: "toggleView" },
      { label: "c commits", action: "commitPicker" },
    ]
  }
  if (treeFocused) {
    return [
      { label: workingView ? "↵ stage" : "↵ unstage", action: "stageFile" },
      workingView ? { label: "v staged", action: "toggleView" } : { label: "C commit", action: "commit" },
    ]
  }
  return [
    { label: "↑↓ scroll", action: "navigate" },
    workingView ? { label: "v staged", action: "toggleView" } : { label: "C commit", action: "commit" },
  ]
}

export function viewerFooterActions(context: ViewerFooterContext, width: number): string[] {
  const activeFiles =
    context.document.mode === "working" ? context.document[context.workingTreeView].files : context.document.diff.files
  const contextual: FooterAction[] = [
    { label: "? help", action: "help" },
    { label: "q close", action: "close" },
    ...contextualActions(context, activeFiles.length > 0),
  ]
  return fitActions(availableActions(context, contextual), width)
}
