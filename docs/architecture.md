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

- **Git services**: `git-service.ts` contains typed process execution and repository checks; `git-status.ts` owns the porcelain-v2 working-tree snapshot. Domain services cover diffs, index/staging, history, branches, stashes, worktrees, commands, and commits.
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

`git-service.ts` is the sole Git process-execution layer. `runGit()` enforces accepted exit codes, while `probeGit()` exposes completed nonzero exits for deliberate fallback flows. Both reject pre-aborted work before spawning and turn killed commands into typed abort or timeout errors. Local reads, mutations/hooks, and network operations use centralized timeout classes.

`git-status.ts` parses one NUL-delimited porcelain-v2 snapshot for HEAD/branch/upstream state, ordinary and renamed entries, conflicts, submodules, staged paths, and untracked paths. Working-tree loading keeps repository discovery and patch generation separate, but does not re-probe that metadata.

Working-tree patch capture is explicitly bounded. `git-diff-capture.ts` estimates tracked source groups before connected, argument-bounded literal-path batches, while `git-untracked-service.ts` batches index membership checks and runs at most four no-index workers. Rename/copy-connected groups stay atomic across batches. Both retain complete Git patch records only and return explicit omission entries when file, byte, argument, or line budgets are reached. Historical metadata and patches use temporary Git output files so parsing is streamed and retained memory remains bounded. `diff-budgets.ts` owns the conservative defaults, and `git-worker-pool.ts` provides deterministic bounded scheduling with terminal cancellation.

Focused service modules implement domain operations:

- `git-diff-service.ts` for working-tree and commit documents
- `git-index-service.ts` for staging and unstaging
- `commit-diff-input.ts` for whole-file, budgeted staged input used by generated commit messages
- `git-history-service.ts` for commit history and messages
- `git-branch-service.ts` for branch listing and switching
- `git-stash-service.ts` for stash operations
- `git-worktree-service.ts` for worktree parsing and listing
- `git-command-service.ts` for command-menu commands
- `commit-message-service.ts` for commit creation and generated messages

`git.ts` and `git-extras.ts` remain compatibility modules so existing viewer and test imports do not need to know the domain-service layout.

## Distribution boundary

`extensions/diff.ts` is the source-development entry. The production build compiles that entry and `src/` as Node ESM into `dist/`, with declarations and source maps, while `package.json` exports and the Pi manifest point only to `dist/extensions/diff.js`.

Every clean build records hashes for its inputs and emitted files in `dist/build-manifest.json`. Packed artifacts contain only the compiled tree and documentation. When the locked compiler is available, `verify:build` performs an isolated clean rebuild and byte comparison. Production-only installs without TypeScript check committed output against the manifest; that is consistency checking rather than independent provenance. The compiled entry performs the same consistency check before registration, and source checkouts also validate input hashes and compiler identity.

## Testing strategy

Tests are intentionally independent from the user's real git repository.

- Parser tests use raw fixtures under `tests/fixtures/`.
- Git service tests use mocked extension APIs and temporary repositories where needed.
- List primitive tests cover search, navigation, scrolling, key detection, and `FilterableListState` behavior directly.
- Overlay controller tests characterize opening, closing, filtering, movement, selection, rendering, and special modes such as branch creation and stash confirmation.
- Viewer/frame tests cover frame layout, scrollbars, help text, overlay merging, structured diff rendering, and omission-only documents.
- Git pipeline budget tests cover fixed process counts, bounded concurrency, canonical small patches, odd paths, large-file omissions, stable ordering, and whole-file commit prompt input.
- Build-freshness tests reject changed inputs and mixed outputs. `npm run smoke:package` packs and installs the tarball, exercises package exports, loads it through Pi, verifies command/shortcut registration, and invokes both handlers.

Run `npm run benchmark:git -- --iterations 3` to compile into isolated temporary output and measure clean, 10/50/500 untracked, large inputs, cancellation, and 600/10,000-file staged scenarios with process-tree RSS checks. `npm run benchmark:render` compares per-frame p50/p95, output sequences, hit ratios, and retained memory against pinned `HEAD`. `npm run benchmark:load -- --iterations 10` reports source-versus-built extension discovery and full Pi RPC command readiness; it makes no physical-cold or interactive-TUI readiness claim.

## Future work

The remaining inheritance scaffolding can be removed once the viewer composes all controllers directly. The intended endpoint is a small `DiffViewer` orchestrator with explicit viewer state, direct controller composition, pure frame/layout renderers, and focused git services behind stable compatibility exports.
