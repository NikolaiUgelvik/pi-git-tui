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
- `PageUp` / `PageDown`: scroll the diff
- `Home` / `End`: jump within the focused panel
- `c`: choose the working tree or a recent commit and view that diff
- Type in the commit picker to search/filter commits; use `Backspace` to edit
- Reopening the commit picker restores its last search/selection state
- `Esc`: close the commit picker and return to the diff view
- `q`: close the viewer

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
