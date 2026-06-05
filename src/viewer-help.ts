import type { HelpContext } from "./types.js"

export interface HelpAction {
  keys?: string
  action: string
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
    { keys: "type", action: "Edit the commit message" },
    { keys: "←/→", action: "Move the commit message caret" },
    { keys: "Home/End", action: "Jump the caret to the start or end" },
    { keys: "Backspace/Delete", action: "Delete around the caret" },
    { keys: "Ctrl+X", action: "Toggle amend mode for the last commit" },
    { keys: "*", action: "Generate a commit message from staged changes" },
    { keys: "Enter", action: "Commit or amend staged changes with the message" },
    { keys: "Esc", action: "Cancel and close the commit dialog" },
    { keys: "?", action: "Show or close this help" },
  ],
  commandMenu: [
    { keys: "type", action: "Filter commands by label, description, or git args" },
    { keys: "Backspace", action: "Delete the previous search character" },
    { keys: "↑/↓", action: "Move to the previous or next command" },
    { keys: "PgUp/PgDn", action: "Jump through commands by page" },
    { keys: "Home/End", action: "Jump to the first or last command" },
    { keys: "Enter", action: "Run the selected git command" },
    { keys: "Esc", action: "Cancel and close the command menu" },
    { keys: "?", action: "Show or close this help" },
  ],
  commitPicker: [
    { keys: "type", action: "Filter commits by hash or message" },
    { keys: "Backspace", action: "Delete the previous search character" },
    { keys: "↑/↓", action: "Move to the previous or next entry" },
    { keys: "PgUp/PgDn", action: "Jump through entries by page" },
    { keys: "Home/End", action: "Jump to the first or last entry" },
    { keys: "Enter", action: "Select the working tree or highlighted commit" },
    { keys: "Esc", action: "Cancel and close the commit picker" },
    { keys: "?", action: "Show or close this help" },
  ],
  confirmDialog: [
    { keys: "Enter", action: "Confirm the action" },
    { keys: "Esc/q", action: "Cancel and close the dialog" },
    { keys: "?", action: "Show or close this help" },
  ],
  branchPicker: [
    { keys: "type", action: "Filter local branches" },
    { keys: "↑/↓", action: "Move through branches" },
    { keys: "Enter", action: "Switch to the selected branch" },
    { keys: "Ctrl+N", action: "Create and switch to a new branch" },
    { keys: "Esc/q", action: "Cancel and close the branch picker" },
    { keys: "?", action: "Show or close this help" },
  ],
  stashPicker: [
    { keys: "Enter", action: "Stash current changes or apply selected stash" },
    { keys: "Ctrl+P", action: "Pop the selected stash after confirmation" },
    { keys: "Ctrl+D", action: "Drop the selected stash after confirmation" },
    { keys: "↑/↓", action: "Move through stash actions" },
    { keys: "Esc/q", action: "Cancel and close the stash picker" },
    { keys: "?", action: "Show or close this help" },
  ],
  worktreePicker: [
    { keys: "type", action: "Filter worktrees by path, branch, or HEAD" },
    { keys: "↑/↓", action: "Move through worktrees" },
    { keys: "Enter", action: "Select the highlighted worktree" },
    { keys: "Esc/q", action: "Cancel and close the worktree picker" },
    { keys: "?", action: "Show or close this help" },
  ],
  viewer: [
    { keys: "Tab", action: "Switch focus between the file tree and diff" },
    { keys: "↑/↓ or j/k", action: "Move files when focused on Files; scroll code in Diff" },
    { keys: "n / p", action: "Move to the next or previous file" },
    { keys: "Enter", action: "Stage or unstage the selected file in the working tree" },
    { keys: "Shift+Enter", action: "Stage all changes, or unstage all when everything is staged" },
    { keys: "PgUp/PgDn", action: "Scroll the diff by half a page" },
    { keys: "Space", action: "Scroll the diff down by half a page" },
    { keys: "Home/End", action: "Jump to the first or last file/line" },
    { keys: "c", action: "Open the commit picker" },
    { keys: "C", action: "Open the staged changes commit dialog" },
    { keys: "I", action: "Initialize a git repository when none is present" },
    { keys: "D", action: "Discard selected working-tree file after confirmation" },
    { keys: "b", action: "Open the branch picker" },
    { keys: "w", action: "Open the worktree picker" },
    { keys: "s", action: "Open stash actions" },
    { keys: "Ctrl+P", action: "Open the git command menu" },
    { keys: "Esc / q", action: "Close the diff viewer" },
    { keys: "?", action: "Show or close this help" },
  ],
}
