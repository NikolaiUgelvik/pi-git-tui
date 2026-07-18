import type { DiffDocument } from "./types.js"

export type ViewerAction =
  | "navigate"
  | "reload"
  | "toggleView"
  | "stageFile"
  | "stageAll"
  | "commit"
  | "discard"
  | "initialize"
  | "branches"
  | "stashes"
  | "commands"
  | "commitPicker"
  | "workingTree"
  | "worktrees"
  | "help"
  | "close"

export interface ViewerActionAvailability {
  available: boolean
  reason?: string
}

const READY_WORKING_ACTIONS = new Set<ViewerAction>([
  "navigate",
  "reload",
  "toggleView",
  "stageFile",
  "stageAll",
  "commit",
  "discard",
  "branches",
  "stashes",
  "commands",
  "commitPicker",
  "worktrees",
  "help",
  "close",
])
const HISTORICAL_ACTIONS = new Set<ViewerAction>([
  "navigate",
  "reload",
  "commitPicker",
  "workingTree",
  "worktrees",
  "help",
  "close",
])
const MISSING_REPOSITORY_ACTIONS = new Set<ViewerAction>(["navigate", "reload", "initialize", "help", "close"])

const ACTION_PHRASES: Record<ViewerAction, string> = {
  navigate: "navigating the diff",
  reload: "reloading the diff",
  toggleView: "switching staged and working views",
  stageFile: "staging or unstaging a file",
  stageAll: "staging or unstaging all changes",
  commit: "committing changes",
  discard: "discarding changes",
  initialize: "initializing a repository",
  branches: "switching or creating branches",
  stashes: "using stashes",
  commands: "running Git commands",
  commitPicker: "opening commit history",
  workingTree: "returning to the working tree",
  worktrees: "switching worktrees",
  help: "opening help",
  close: "closing the viewer",
}

export function viewerActionAvailability(document: DiffDocument, action: ViewerAction): ViewerActionAvailability {
  if (availableActions(document).has(action)) {
    return { available: true }
  }
  return { available: false, reason: unavailableActionReason(document, action) }
}

export function isViewerActionAvailable(document: DiffDocument, action: ViewerAction): boolean {
  return availableActions(document).has(action)
}

function availableActions(document: DiffDocument): ReadonlySet<ViewerAction> {
  if (document.mode === "commit") {
    return HISTORICAL_ACTIONS
  }
  return document.repositoryState === "missing" ? MISSING_REPOSITORY_ACTIONS : READY_WORKING_ACTIONS
}

function unavailableActionReason(document: DiffDocument, action: ViewerAction): string {
  if (document.mode === "commit") {
    return `Return to the working tree with W before ${ACTION_PHRASES[action]}.`
  }
  if (document.repositoryState === "missing") {
    return `Initialize a Git repository with I before ${ACTION_PHRASES[action]}.`
  }
  if (action === "workingTree") {
    return "Already viewing the working tree."
  }
  if (action === "initialize") {
    return "A Git repository is already available."
  }
  return `Cannot continue ${ACTION_PHRASES[action]}.`
}
