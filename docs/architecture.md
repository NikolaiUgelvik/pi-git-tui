# pi-git Architecture

## Overview

`pi-git` provides the `/diff` extension command: an interactive terminal UI for browsing working-tree and commit diffs, staging and discarding changes, committing, and using branch, stash, worktree, help, and command overlays.

The viewer keeps rendering and overlay controllers separate from repository observation and side-effect coordination. A complete Git document is accepted atomically; mutations never own their retry path, and asynchronous completions cannot overwrite a newer cwd or document generation.

## Runtime flow

1. `src/extension.ts` registers `/diff` and loads an explicit initial result.
2. A successful load supplies a complete `DiffDocument`. A failed load supplies a `ViewerInitialDocument` failure; it is not converted into a clean document.
3. `ViewerDocumentState` owns the active cwd, accepted document generation, current load request, selected logical path aliases, vertical and horizontal diff positions, last complete document, and load failure.
4. `ViewerOperationCoordinator` serializes foreground loads and mutations. Every operation captures its id, cwd, and document generation.
5. `DiffViewerFrame` renders the base frame and derives feedback from typed operation state. Running work is neutral; only completed work receives a check mark.
6. Active overlay controllers render over the frame and delegate effects to viewer adapters.

## Complete document loading

`src/git-diff-service.ts` is the Git snapshot boundary. `loadWorkingTreeDocument()` and `loadCommitDocument()`:

- recognize a missing repository only from Git's expected exit-128 stderr diagnostic, while treating bare/non-worktree repositories as explicit failures;
- model an unborn HEAD explicitly;
- load two required, index-exact slices: `git diff --cached` for HEAD → index and `git diff` for index → working tree, then add bounded untracked previews only to the working slice;
- assert required branch, staged diff, working diff, untracked-path, conflict, and historical-diff queries;
- reject killed/timed-out processes and unexpected exit codes;
- accept exit code `1` only for `git diff --no-index`, where it means differences were found;
- preserve full command, cwd, stdout, and stderr details in `GitCommandError`.

`src/untracked-preview-service.ts` bounds untracked augmentation independently from snapshot orchestration. It batch-checks all discovered paths against the index and HEAD before applying preview budgets, then uses an order-preserving worker pool with at most four active filesystem or patch reads. It previews at most 100 files and 1 MiB in aggregate and retains budget-exhausted, oversized, and non-regular paths as stageable placeholders. `lstat()` keeps symlinks—including broken links—eligible as symlink patches instead of following or dropping their targets; only expected disappearance races (`ENOENT` and `ENOTDIR`) are omitted, while other filesystem failures reject the complete snapshot. Patches are admitted atomically rather than truncated, so binary detection and per-file diff parsing remain Git-owned. Missing or newly tracked paths are still omitted, and unexpected or killed Git results still reject the complete snapshot.

`src/diff-document.ts` parses and decorates both slices, matches logical files through `path`, `oldPath`, and `newPath` aliases, derives `staged`, `unstaged`, `mixed`, and `conflicted` state, and computes file/addition/deletion totals. Historical documents expose one commit slice. `src/diff-document-loader.ts` routes a `DiffLoadRequest` to working-tree or historical loading without callers rebuilding contexts.

A missing repository is a valid loaded document with `repositoryState: "missing"`. A clean repository is a valid loaded document with no files. A snapshot failure is separate state that retains the last complete document and a retryable request.

## Document state

`src/viewer-document-state.ts` owns document acceptance:

- `activeCwd` changes only when a target document is accepted;
- every accepted replacement increments `generation`;
- selection is preserved by matching `path`, `oldPath`, and `newPath` aliases;
- the active staged/working view is explicit and survives reloads, while each view maintains a valid logical-path selection;
- failed worktree loads do not change cwd or discard the prior document;
- startup and reload failures remain distinct from clean and missing-repository states.

The `r` action reloads the active working-tree or historical request. When selecting a new historical document fails, its failed target is retained separately from the last accepted document so `r` retries the intended commit without making the accepted working document unavailable. The user can reopen history or press `W` to abandon that failed target. If a mutation has a pending refresh failure, `r` executes that stored refresh intent instead. Changing the selected logical file, replacing the document, or switching staged/working slices resets the horizontal viewport; merely switching panel focus preserves it.

## Index-exact staging and commit review

Working documents contain `staged` and `working` `DiffSlice` values. The viewer never reconstructs one from the other:

- `v` changes the visible slice without changing repository state;
- Enter in the working view runs `stageRemainingFile()`, while Enter in the staged view runs `unstageFile()`;
- Shift+Enter runs explicit `stageAllRemaining()` or `unstageAll()` operations;
- mixed files appear in both slices with a mixed glyph, and conflicts remain a separate state;
- headers show both slices' file and line totals;
- the first `C` enters the exact staged review and the second opens the commit dialog;
- normal commit is blocked when the staged slice is empty, both in the viewer and at the Git commit seam;
- amend remains available with an existing HEAD and an empty staged slice, where it is labelled as a message/tree-only amend;
- commit-message generation always consumes the staged Git diff and is unavailable when no staged changes exist.

Explicit index operations replace the prior stage/unstage toggle, so staging the remaining hunk of a mixed file cannot accidentally erase its existing partial staging. Rename aliases are passed together to index operations. Discard classifies every logical alias against the current HEAD and index, restores HEAD-tracked aliases, removes index-only aliases, cleans only resulting untracked aliases, and verifies that no selected staged or working diff remains.

Force-push execution requires a successful porcelain dry run and a second confirmation. URL userinfo is redacted from resolved destinations and from every preview failure message, detail string, and wrapped Git result before it reaches viewer feedback.

## Operation coordination

`src/viewer-operation-coordinator.ts` exposes one foreground operation state:

- `idle`
- `running`
- `cancelling`
- `reconciling`
- `succeeded`
- `failed`
- `refreshFailed`

Mutation execution and refresh execution have separate error boundaries:

- mutation failure does not imply a refresh;
- mutation success plus refresh failure retains the success message and stores only a refresh intent;
- retry never retains or reruns the mutation closure;
- repeated mutations are rejected while another foreground operation is active;
- resolved and rejected completions publish only while their operation id, captured cwd, and document generation remain current;
- repeated refresh failures accumulate diagnostics instead of erasing the original mutation or reconciliation failure;
- every mutation carries a reconciliation refresh intent, even when its successful path does not need to refresh.

Escape aborts observation through an operation-scoped `AbortController`. Cancelling a mutation does not undo it, so the coordinator enters mandatory reconciliation before allowing another mutation. If reconciliation fails, mutations remain blocked until refresh-only retry succeeds. Commands are rejected while a historical document is active because reloading that commit would not meaningfully reconcile current working-tree side effects.

Commands marked as refreshing repository state reconcile after nonzero results, including fetch and pull; commit and stash operations also reconcile because hooks or conflicts can mutate the index/worktree before failing. Load, mutation, and reconciliation execution live in focused modules behind the coordinator's lifecycle facade.

## Commit-message generation

`src/commit-message-service.ts` bounds staged-diff loading, session creation, and model prompting with `COMMIT_MESSAGE_TIMEOUT_MS` and an operation abort signal. Timeout or Escape requests `session.abort()` and disposes immediately without waiting on a potentially stuck provider abort; a session that finishes creating after cancellation is likewise aborted and disposed without prompting. The commit dialog uses both operation generation and a dialog epoch, so a late model response cannot repopulate a closed dialog or a changed document context.

## Stash-list recovery

The stash picker keeps a request generation independent from the repository document generation. Escape is handled before its loading guard, so a late list completion cannot reopen a closed picker.

After a successful stash mutation, a failed `stash list` refresh:

- keeps the successful mutation result;
- retains the prior stash rows;
- leaves viewer and controller loading states;
- displays a warning with `r` to retry listing only while retaining full Git failure details.

The stash mutation is never retained for retry.

## Responsive rendering and diff viewports

`src/responsive-geometry.ts` is the single source of truth for frame and overlay bounds. The frame is always at most `terminalRows - 2` rows and exactly the supplied render width. Widths below 72 columns show only the focused Files or Diff panel, with Tab switching the visible panel; wider frames use the split layout. Clean, missing, and startup-failure documents use one full-width summary panel. Short frames remove decorative chrome before functional rows, and dimensions below the usable minimum render a bounded resize instruction.

All overlay controllers use `src/overlay-frame.ts`, while `viewer-overlay-base.ts` uses the same measured rectangle when merging. `ViewerOverlayCoordinator` selects one authoritative feature overlay for focus, help, rendering, input, opening, and lifecycle; controllers register adapters instead of rebuilding priority through inheritance hooks. Overlay width and height are capped before rows are built, compact force-push confirmation prioritizes the resolved destination and ref updates, and defensive merging cannot append beyond the base frame. Help wraps entries into physical display rows before `HelpOverlayState` paginates them, keeping complete descriptions reachable at narrow widths.

`src/diff-viewport.ts` owns structured diff rows, a fixed line-number gutter, vertical scrollbar reservation, and the independently clamped horizontal column. Only the content region moves. `sliceStyledColumns()` normalizes tabs, slices by grapheme and terminal cell, replays and closes ANSI state, and substitutes blank cells when a boundary crosses a wide grapheme. Left/Right move four cells and Shift+Left/Right move sixteen; the Diff title reports the active column and overflow direction.

## Module groups

- **Execution and snapshots**: `git-service.ts`, `git-diff-service.ts`, `untracked-preview-service.ts`, `diff-document.ts`, `diff-document-loader.ts`, `git-file-list-service.ts`, `git-status.ts`, and focused Git domain services.
- **Document and operation state**: `viewer-document-state.ts`, `viewer-operation-types.ts`, `viewer-operation-coordinator.ts`, and `viewer-operation-base.ts`.
- **Viewer/frame**: `viewer.ts`, `viewer-core.ts`, `viewer-navigation-base.ts`, `viewer-frame.ts`, `viewer-overlay-coordinator.ts`, `responsive-geometry.ts`, `diff-viewport.ts`, `help-overlay-state.ts`, and overlay-specific viewer adapters.
- **Overlay controllers**: commit, command, branch, stash, and worktree controllers own local filtering, selection, and rendering state; `overlay-frame.ts` provides their shared bounded chrome.
- **Parser/display**: diff parser, tree, structured diff display, and ANSI terminal-column modules.

## Testing strategy

Tests avoid the user's repository and use deterministic fake `ExtensionAPI.exec` calls, deferred promises, and temporary files.

Focused suites cover:

- every required snapshot query and expected Git exit path;
- staged-only, working-only, mixed, untracked, renamed, conflicted, binary, clean, missing, unborn-HEAD, and failed historical documents;
- deterministic file/all stage and unstage behavior, including mixed files and unborn repositories;
- staged/working view routing, exact staged commit review, zero-staged commit gating, and empty-index amend behavior;
- mutation failure versus post-mutation refresh failure;
- refresh-only retry call counts;
- repeated mutation rejection;
- cancellation and reconciliation;
- stale cwd/generation completions and atomic worktree changes;
- commit-message timeout/abort/disposal;
- stash-list late resolution/rejection and warning-only recovery;
- startup/manual reload, selection preservation, neutral loading, and full failure details;
- width/height matrices for split, single-panel, empty, compact overlay, and scrollable-help layouts;
- horizontal diff offsets with fixed gutters, ANSI, tabs, combining text, CJK, emoji, and resize clamping;
- 1,000-path untracked preview fan-out, deterministic ordering, aggregate budgets, abort behavior, race checks, binary files, large files, missing paths, directories, and symlinks.
