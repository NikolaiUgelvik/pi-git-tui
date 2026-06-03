# pi-git

A Pi package that adds an interactive git diff viewer command.

Review your changes, stage files, browse recent commits, run common git commands, and commit without leaving Pi. It is meant to make everyday git work feel native while you are already coding with an agent.

## Command

```text
/diff
```

## Installation

Install from GitHub:

```bash
pi install git:github.com/NikolaiUgelvik/py-git
```

For local development, load the extension directly:

```bash
pi -e ./extensions/diff.ts
```

Or install from a local checkout:

```bash
pi install ./path/to/pi-git
```
