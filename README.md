<p align="center"><img width="827" height="318" alt="image" src="https://github.com/user-attachments/assets/56377402-03c7-4af6-a543-73a45f39e8c6" /></p>

# pi-git

A Pi package that adds an interactive git diff viewer command.

Review your changes, stage files, browse recent commits, run common git commands, and commit without leaving Pi. It is meant to make everyday git work feel native while you are already coding with an agent.

## Command

```text
/diff
```

## Keyboard shortcut

- macOS: <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd>
- Other platforms: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd>

## Installation

Install from GitHub:

```bash
pi install git:github.com/NikolaiUgelvik/pi-git
```

For local development, load the extension directly:

```bash
pi -e ./extensions/diff.ts
```

Or install from a local checkout:

```bash
pi install ./path/to/pi-git
```
