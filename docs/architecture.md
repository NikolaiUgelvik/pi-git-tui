# pi-git Architecture

## Overview

`pi-git` provides the `/diff` extension command: an interactive terminal UI for browsing working-tree diffs, staging and discarding changes, opening commit diffs, committing staged changes, and using branch, stash, worktree, help, and command overlays.

The current architecture keeps the existing viewer behavior while moving complexity toward composition. Viewer classes still provide compatibility scaffolding, but overlay-specific state, input handling, and line rendering now live in focused controller modules. Git operations are split into domain services behind compatibility exports.

## Runtime flow

1. The extension registers the `/diff` command from `src/extension.ts`.
2. Command execution loads the initial working-tree diff through `loadWorkingTreeDiff()`.
3. A `DiffViewer` instance owns the active `DiffDocument`, selected file, scroll position, focused panel, active cwd, and status/error messages.
4. `DiffViewerFrame` renders the base frame: header, file tree, diff panel, footer, and scrollbars.
5. Active overlays render over the frame. Overlay controllers produce overlay lines; viewer classes merge those lines and perform side effects.
6. Git operations go through `src/git.ts` and `src/git-extras.ts` compatibility exports, which forward to focused service modules.

## Module groups

- **Git services**: `git-service.ts` contains core process execution and repository checks. Domain services cover diffs, index/staging, history, branches, stashes, worktrees, commands, and commits.
- **Viewer/frame**: `viewer.ts`, `viewer-core.ts`, `viewer-frame.ts`, and overlay-specific viewer files own the runtime document, terminal frame, overlay routing, and side effects.
- **Overlay controllers**: `command-menu-controller.ts`, `commit-picker-controller.ts`, `branch-picker-controller.ts`, `stash-picker-controller.ts`, and `worktree-picker-controller.ts` own overlay-local state, input handling, and overlay line rendering.
- **List primitives**: `filterable-list-state.ts` provides shared search, key handling, selection, scrolling, and visible-item calculations for filterable overlays.
- **Parser/display**: `diff-parser.ts`, `diff-display.ts`, and related rendering helpers convert git output into structured rows and styled display text.
- **Tests**: Fixture-based parser tests, isolated git service tests, list primitive tests, controller characterization tests, and viewer/frame tests preserve behavior through refactors.

## Overlay controller pattern

Each overlay controller owns only overlay-local concerns:

- search text, selected index, scroll offset, loading/open/create/confirm state
- input handling for search, navigation, cancellation, and selection
- pure `renderOverlayLines(...)` output for the overlay body

The viewer remains responsible for side effects and shared state:

- loading git data
- changing the active document or active cwd
- setting status/error/loading messages
- requesting terminal re-renders
- merging overlay lines onto the base frame

This boundary keeps overlay logic testable without a live git repository or terminal session.

## Git service pattern

`git-service.ts` is the core execution layer. It exposes `git()`, repository detection helpers, and git-result formatting/assertion utilities.

Focused service modules implement domain operations:

- `git-diff-service.ts` for working-tree, staged, commit, and range diffs
- `git-index-service.ts` for staging and unstaging
- `git-history-service.ts` for commit history and messages
- `git-branch-service.ts` for branch listing and switching
- `git-stash-service.ts` for stash operations
- `git-worktree-service.ts` for worktree parsing and listing
- `git-command-service.ts` for command-menu commands
- `commit-message-service.ts` for commit creation and generated messages

`git.ts` and `git-extras.ts` remain compatibility modules so existing viewer and test imports do not need to know the domain-service layout.

## Testing strategy

Tests are intentionally independent from the user's real git repository.

- Parser tests use raw fixtures under `tests/fixtures/`.
- Git service tests use mocked extension APIs and temporary repositories where needed.
- List primitive tests cover search, navigation, scrolling, key detection, and `FilterableListState` behavior directly.
- Overlay controller tests characterize opening, closing, filtering, movement, selection, rendering, and special modes such as branch creation and stash confirmation.
- Viewer/frame tests cover frame layout, scrollbars, help text, overlay merging, and structured diff rendering.

## Future work

The remaining inheritance scaffolding can be removed once the viewer composes all controllers directly. The intended endpoint is a small `DiffViewer` orchestrator with explicit viewer state, direct controller composition, pure frame/layout renderers, and focused git services behind stable compatibility exports.
