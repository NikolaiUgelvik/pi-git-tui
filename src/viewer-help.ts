import type { DiffDocument, HelpContext } from "./types.js"
import { isViewerActionAvailable, type ViewerAction } from "./viewer-action-policy.js"

export interface HelpAction {
  keys?: string
  action: string
  viewerAction?: ViewerAction
}

export const HELP_TITLES: Record<HelpContext, string> = {
  branchPicker: "Branch picker help",
  commandMenu: "Command menu help",
  commitDialog: "Commit dialog help",
  commitPicker: "Commit picker help",
  confirmDialog: "Confirmation help",
  stashPicker: "Stash picker help",
  worktreePicker: "Worktree picker help",
  viewer: "Diff viewer help",
}

export const HELP_ACTIONS: Record<HelpContext, HelpAction[]> = {
  commitDialog: [
    { keys: "type", action: "Edit the commit message; printable ?, *, and q are text" },
    { keys: "←/→", action: "Move the commit message caret by grapheme" },
    { keys: "Home/End", action: "Jump the caret to the start or end" },
    { keys: "Backspace/Delete", action: "Delete one grapheme around the caret" },
    { keys: "Ctrl+X", action: "Toggle amend mode for the last commit" },
    { keys: "Ctrl+G", action: "Generate a commit message from staged changes" },
    { keys: "Enter", action: "Commit or amend staged changes with the message" },
    { keys: "Esc", action: "Cancel and close the commit dialog" },
    { keys: "F1", action: "Show or close this help" },
  ],
  commandMenu: [
    { keys: "type", action: "Filter commands by label, description, or git args" },
    { keys: "Backspace", action: "Delete the previous search grapheme" },
    { keys: "↑/↓", action: "Move to the previous or next command" },
    { keys: "PgUp/PgDn", action: "Jump through commands by page" },
    { keys: "Home/End", action: "Jump to the first or last command" },
    { keys: "Enter", action: "Run a safe command or preview a force push" },
    { keys: "Esc", action: "Cancel and close the command menu" },
    { keys: "F1", action: "Show or close this help" },
  ],
  commitPicker: [
    { keys: "type", action: "Filter commits by hash or message" },
    { keys: "Backspace", action: "Delete the previous search grapheme" },
    { keys: "↑/↓", action: "Move to the previous or next entry" },
    { keys: "PgUp/PgDn", action: "Jump through entries by page" },
    { keys: "Home/End", action: "Jump to the first or last entry" },
    { keys: "Enter", action: "Select the working tree or highlighted commit" },
    { keys: "Esc", action: "Cancel and close the commit picker" },
    { keys: "F1", action: "Show or close this help" },
  ],
  confirmDialog: [
    { keys: "Enter", action: "Confirm the named action" },
    { keys: "Esc", action: "Cancel and close the dialog" },
    { keys: "F1", action: "Show or close this help" },
  ],
  branchPicker: [
    { keys: "type", action: "Filter local branches or enter a branch name" },
    { keys: "↑/↓", action: "Move through branches" },
    { keys: "Enter", action: "Switch to the selected branch" },
    { keys: "Ctrl+N", action: "Create and switch to a new branch" },
    { keys: "Esc", action: "Cancel the active field or close the branch picker" },
    { keys: "F1", action: "Show or close this help" },
  ],
  stashPicker: [
    { keys: "type", action: "Filter stashes; printable q enters the search" },
    { keys: "Enter", action: "Stash current changes or apply the selected stash" },
    { keys: "Ctrl+P", action: "Review and confirm popping the selected stash" },
    { keys: "Ctrl+D", action: "Review and confirm dropping the selected stash" },
    { keys: "r", action: "Retry stash listing after a list refresh warning" },
    { keys: "↑/↓", action: "Move through stash actions" },
    { keys: "Esc", action: "Cancel and close the stash picker" },
    { keys: "F1", action: "Show or close this help" },
  ],
  worktreePicker: [
    { keys: "type", action: "Filter worktrees by path, branch, or HEAD" },
    { keys: "↑/↓", action: "Move through worktrees" },
    { keys: "Enter", action: "Select the highlighted worktree" },
    { keys: "Esc", action: "Cancel and close the worktree picker" },
    { keys: "F1", action: "Show or close this help" },
  ],
  viewer: [
    { keys: "Ctrl+P", action: "Open the Git command menu", viewerAction: "commands" },
    { keys: "Tab", action: "Switch focus between the file tree and diff", viewerAction: "navigate" },
    {
      keys: "↑/↓ or j/k",
      action: "Move files when focused on Files; scroll code in Diff",
      viewerAction: "navigate",
    },
    { keys: "n / p", action: "Move to the next or previous file", viewerAction: "navigate" },
    { keys: "v", action: "Toggle index-exact staged and working change views", viewerAction: "toggleView" },
    {
      keys: "Enter",
      action: "Stage remaining changes, or unstage the selected staged file",
      viewerAction: "stageFile",
    },
    {
      keys: "Shift+Enter",
      action: "Stage all remaining changes, or unstage all staged changes",
      viewerAction: "stageAll",
    },
    { keys: "PgUp/PgDn", action: "Scroll the diff by half a page", viewerAction: "navigate" },
    { keys: "←/→", action: "Scroll diff content horizontally by four columns", viewerAction: "navigate" },
    { keys: "Shift+←/→", action: "Scroll diff content horizontally by sixteen columns", viewerAction: "navigate" },
    { keys: "Space", action: "Scroll the diff down by half a page", viewerAction: "navigate" },
    { keys: "Home/End", action: "Jump to the first or last file/line", viewerAction: "navigate" },
    { keys: "r", action: "Reload the active diff, or retry a failed refresh only", viewerAction: "reload" },
    { keys: "c", action: "Open the commit picker", viewerAction: "commitPicker" },
    { keys: "W", action: "Return directly to the working tree", viewerAction: "workingTree" },
    { keys: "C", action: "Review staged-only changes; press again to open commit", viewerAction: "commit" },
    { keys: "I", action: "Initialize a git repository when none is present", viewerAction: "initialize" },
    { keys: "D", action: "Discard selected working-tree file after confirmation", viewerAction: "discard" },
    { keys: "b", action: "Open the branch picker", viewerAction: "branches" },
    { keys: "w", action: "Open the worktree picker", viewerAction: "worktrees" },
    { keys: "s", action: "Open stash actions", viewerAction: "stashes" },
    { keys: "Esc / q", action: "Close the diff viewer", viewerAction: "close" },
    { keys: "? / F1", action: "Show or close this help", viewerAction: "help" },
  ],
}

export function helpActionsForDocument(context: HelpContext, document: DiffDocument): HelpAction[] {
  if (context !== "viewer") {
    return HELP_ACTIONS[context]
  }
  return HELP_ACTIONS.viewer.filter(
    (action) => action.viewerAction === undefined || isViewerActionAvailable(document, action.viewerAction),
  )
}
