# pi-git

A Pi package that adds an interactive git diff viewer command.

## Command

```text
/diff
```

Opens a two-panel TUI:

- left: tree of changed files
- right: stacked/unified diff with additions and removals color coded

## Keys

- `Tab`: switch focus between the file tree and diff/code panel
- `↑` / `↓` or `k` / `j`: move in the focused panel (files or code)
- `n` / `p`: switch to the next/previous file from any focused panel
- `Enter`: stage or unstage the selected file when the file tree is focused
- `PageUp` / `PageDown`: scroll the diff
- `Home` / `End`: jump within the focused panel
- `c`: choose the working tree or a recent commit and view that diff
- `C`: open a commit dialog for staged changes
- `*`: generate a commit message with the current model while the commit dialog is open
- `Ctrl+P`: open a searchable git command menu
- Type in the commit picker or command menu to search/filter; use `Backspace` to edit
- Reopening the commit picker restores its last search/selection state
- `Esc`: close the active picker/menu or close the viewer
- `q`: close the viewer

The command menu includes `Fetch`, `Pull`, `Pull (Rebase)`, `Push`, and `Force Push`.

Staged files are marked with `●` in the file tree. The header shows the repository path and current branch.

By default `/diff` opens the current working tree diff against `HEAD`, including staged and unstaged changes. Untracked text files are appended to the working-tree view.

## Install locally while developing

From this repository:

```bash
pi -e ./extensions/diff.ts
```

Or install as a local Pi package:

```bash
pi install ./path/to/pi-git
```
