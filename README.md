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

For source development, install the development dependencies and let Pi load TypeScript directly:

```bash
npm install
npm run dev
```

A local package install uses the same compiled entry point as GitHub and npm packages:

```bash
npm run build
pi install ./path/to/pi-git
```

The compiled entry checks its build-manifest consistency before registering `/diff`, so missing or mixed installed output fails before extension modules execute. In a source checkout it also checks input hashes and the locked compiler identity; `npm run verify:build` supplies the independent clean-rebuild proof.

## Developer loop

Use the persistent incremental type checker while editing:

```bash
npm run typecheck
npm run typecheck:watch
```

Run one or more test files without paying for a clean compile on every invocation:

```bash
npm run test:file -- tests/diff-parser.test.ts
npm run test:watch -- tests/diff-parser.test.ts
```

Omit the path from `test:watch` to watch the full test set discovered at startup. Targeted test commands still type-check the complete production and test program, but execute only the requested tests. They retain emitted tests and TypeScript build information in the Git-ignored `.tmp-tests/` directory; incremental type checking uses `.tmp-typecheck/`.

Use `npm run test:clean`, `npm run typecheck:clean`, or `npm run clean:dev` to remove that state. `npm test` is deliberately different from the targeted loop: it starts from clean test output, runs every `tests/**/*.test.ts` file, and removes its output afterward. `npm run check` uses that single compile for both production and test type diagnostics before the remaining repository gates.

Run `npm run benchmark:loop` to measure source-edit-to-result latency in an isolated copy. It performs 20 semantic source edits, reports command and persistent-watch p50/p95 separately for compiler and test completion, records machine/filesystem metadata, and restores/deletes all fixtures. Use `npm run benchmark:loop -- --assert` only in a controlled environment to enable the environment-sensitive ceiling.

## Build and package checks

```bash
npm run build
npm run verify:build
npm run smoke:package
```

`npm run build` cleans `dist/` and emits production ESM JavaScript, declarations, and JavaScript source maps from `src/` and `extensions/`; tests are excluded. Declaration maps are intentionally disabled because the package does not ship TypeScript sources. `npm run verify:build` checks the locked compiler, rebuilds in an isolated temporary directory, and byte-compares the canonical output. `npm pack` runs the same clean build through `prepack`, and the package tarball contains only `dist/`, `README.md`, and npm's package metadata.

GitHub installs use the committed `dist/` tree because Pi installs git packages with production dependencies only. The `prepare` lifecycle rebuilds when the locked TypeScript compiler is installed and otherwise checks output against the committed manifest. CI and `verify:build` establish source-to-output reproducibility with an isolated clean rebuild; an artifact-local manifest alone is consistency checking, not tamper-resistant provenance.

Measure repeated source-versus-built loading with:

```bash
npm run benchmark:load -- --iterations 10
```

Each sample starts fresh discovery and full Pi RPC processes, so process and module caches are cold. The benchmark warms and does not flush the filesystem page cache; its results are cache-warm measurements, not physical-cold claims. It reports the extension-loader segment, extension-discovery process wall time, and full Pi RPC `/diff` command readiness separately. RPC readiness includes Pi initialization but not interactive TUI readiness.

`npm run check` treats Biome, coverage-backed tests, reproducible build/package checks, Fallow dead-code analysis, and the changed-code complexity/duplication audit as blocking gates. `npm run benchmark:ci` runs the slower process, memory, render, Pi-readiness, and developer-loop thresholds intended for a controlled performance environment.

## Large diffs

Working-tree, historical, and generated commit-message inputs use explicit file, byte, argument, and line budgets. Paths that exceed a budget remain visible in the file tree with an `(omitted)` marker; selecting one shows the measured size, applicable limit, and omission reason. Patches are retained only as complete Git file records and are never sliced mid-hunk. On Unix, filenames containing invalid UTF-8 bytes are shown only as non-actionable omissions because Pi's extension executor transports output and arguments as JavaScript strings.

To exercise the clean, 10/50/500-file, large untracked, large tracked, and large staged fixtures:

```bash
npm run benchmark:git -- --iterations 3
```
