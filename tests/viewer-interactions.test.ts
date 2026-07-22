import assert from "node:assert/strict"
import { test } from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { buildCommitDocument } from "../src/diff-document.js"
import type { ConfirmAction, DiffDocument, DiffFile, GitCommand } from "../src/types.js"
import { GIT_COMMANDS } from "../src/types.js"
import { DiffViewer } from "../src/viewer.js"
import { deferred } from "./helpers/deferred.js"
import {
  flushViewerWork,
  gitResult,
  testTheme,
  testViewerOptions,
  waitForViewerIdle,
  workingDocument,
  workingSnapshotResult,
} from "./helpers/viewer.js"

type ExecOptions = { cwd?: string; signal?: AbortSignal; timeout?: number }

function patch(path: string, after = "new"): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", "-old", `+${after}`].join(
    "\n",
  )
}

const stagedFile: DiffFile = {
  path: "staged.ts",
  status: "modified",
  stageState: "staged",
  lines: patch("staged.ts").split("\n"),
}

class InteractionViewer extends DiffViewer {
  readonly generated = deferred<string>()
  generationCalls = 0
  generationSignal: AbortSignal | undefined

  protected override requestGeneratedCommitMessage(signal: AbortSignal): Promise<string> {
    this.generationCalls += 1
    this.generationSignal = signal
    return this.generated.promise
  }

  openBranchForRouting(): void {
    this.branchState = "open"
    this.branchPickerController.open([{ name: "qa/q-branch", current: false }])
  }

  openCommandConfirmationForRouting(): void {
    const command = GIT_COMMANDS.find((item) => item.risk.kind === "force-push")
    assert.ok(command)
    this.commandMenuController.open()
    this.commandMenuController.showForcePushConfirmation(command, {
      command: "git push --force-with-lease",
      destination: "https://example.com/org/repo.git",
      updates: [{ flag: "+", source: "refs/heads/main", destination: "refs/heads/main", summary: "forced" }],
    })
    this.commandMenuState = this.commandMenuController.state
  }

  openStashForRouting(): void {
    this.stashState = "open"
    this.stashPickerController.open([{ ref: "stash@{0}", message: "saved work" }])
  }

  activeFieldFocused(): boolean {
    return this.activeTextField()?.focused ?? false
  }

  branchQuery(): string {
    return this.branchPickerController.list.searchQuery
  }

  commitText(): string {
    return this.commitMessage
  }

  help(): string | undefined {
    return this.helpContext
  }

  overlayStates(): string[] {
    return [this.branchState, this.stashState, this.commandMenuState, this.confirmState, this.commitDialogState]
  }

  currentMode(): DiffDocument["mode"] {
    return this.document.mode
  }

  selectedPath(): string | undefined {
    return this.files[this.selectedFileIndex]?.path
  }

  picker(): string {
    return this.pickerState
  }

  busy(): boolean {
    return this.isOperationBusy()
  }

  clearFeedback(): void {
    this.error = undefined
    this.errorDetails = undefined
    this.statusMessage = undefined
  }

  commandState(): string {
    return this.commandMenuState
  }

  async invokeStaleMutations(file: DiffFile): Promise<void> {
    await this.updateSelectedFileStage(file)
    await this.stageAllVisibleChanges()
    await this.runBranchSwitch("feature")
    await this.runStashApply("stash@{0}")
    await this.runSelectedCommand(GIT_COMMANDS[0] as GitCommand)
    this.confirmAction = "discard"
    this.confirmFile = file
    this.confirmState = "open"
    await this.runConfirmedAction()
    await this.commitStagedChanges("historical mutation")
  }
}

class ConfirmationViewer extends InteractionViewer {
  confirmed = 0

  protected override executeConfirmedAction(
    _action: ConfirmAction | undefined,
    _file: DiffFile | undefined,
    _cwd: string,
    _signal: AbortSignal,
  ): Promise<string> {
    this.confirmed += 1
    return Promise.resolve("Discarded")
  }
}

function viewer(
  document: DiffDocument,
  pi: ExtensionAPI = {} as ExtensionAPI,
  done: () => void = () => {},
): InteractionViewer {
  return new InteractionViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    document,
    done,
    () => {},
    () => 40,
    testViewerOptions,
  )
}

function historicalDocument(raw = `${patch("a.ts")}\n${patch("b.ts")}`): DiffDocument {
  return buildCommitDocument({
    title: "Commit abc123",
    subtitle: "/repo • historical",
    raw,
    commit: { hash: "abc123", message: "historical" },
  })
}

test("commit editor owns printable ?, *, and q while F1 and Ctrl+G remain shortcuts", async () => {
  const diffViewer = viewer(workingDocument("/repo", { stagedFiles: [stagedFile] }))
  diffViewer.handleInput("C")
  diffViewer.handleInput("C")

  diffViewer.handleInput("?*q")
  assert.equal(diffViewer.commitText(), "?*q")
  assert.equal(diffViewer.help(), undefined)
  assert.equal(diffViewer.generationCalls, 0)

  diffViewer.handleInput("\x1bOP")
  assert.equal(diffViewer.help(), "commitDialog")
  assert.equal(diffViewer.commitText(), "?*q")
  diffViewer.handleInput("\x1bOP")

  diffViewer.handleInput("\x07")
  await flushViewerWork(2)
  assert.equal(diffViewer.generationCalls, 1)
  diffViewer.generated.resolve("fix: generated")
  await flushViewerWork()
  assert.equal(diffViewer.commitText(), "fix: generated")
})

test("search editors receive punctuation before global help and close routing", () => {
  const diffViewer = viewer(workingDocument())
  diffViewer.openBranchForRouting()

  diffViewer.handleInput("?*q")

  assert.equal(diffViewer.branchQuery(), "?*q")
  assert.equal(diffViewer.help(), undefined)
  assert.equal(diffViewer.overlayStates()[0], "open")
  diffViewer.handleInput("\x1bOP")
  assert.equal(diffViewer.help(), "branchPicker")
  assert.equal(diffViewer.branchQuery(), "?*q")
})

test("command confirmation owns F1, ?, and Escape", () => {
  const diffViewer = viewer(workingDocument())
  diffViewer.openCommandConfirmationForRouting()

  diffViewer.handleInput("\x1bOP")
  assert.equal(diffViewer.help(), "confirmDialog")
  diffViewer.handleInput("\x1b")
  assert.equal(diffViewer.help(), undefined)
  assert.equal(diffViewer.commandState(), "confirm")

  diffViewer.handleInput("?")
  assert.equal(diffViewer.help(), "confirmDialog")
  diffViewer.handleInput("?")
  diffViewer.handleInput("\x1b")
  assert.equal(diffViewer.commandState(), "open")
})

test("stash confirmation releases search focus and owns F1, ?, and Escape", () => {
  const diffViewer = viewer(workingDocument())
  diffViewer.focused = true
  diffViewer.openStashForRouting()
  diffViewer.handleInput("\x1b[B")
  diffViewer.handleInput("\x04")
  diffViewer.render(120)

  assert.equal(diffViewer.overlayStates()[1], "confirm")
  assert.equal(diffViewer.activeFieldFocused(), false)
  diffViewer.handleInput("\x1bOP")
  assert.equal(diffViewer.help(), "confirmDialog")
  diffViewer.handleInput("\x1b")
  assert.equal(diffViewer.help(), undefined)

  diffViewer.handleInput("?")
  assert.equal(diffViewer.help(), "confirmDialog")
  diffViewer.handleInput("?")
  diffViewer.handleInput("\x1b")
  assert.equal(diffViewer.overlayStates()[1], "open")
})

test("base viewer keeps ? help and q close behavior", () => {
  let closes = 0
  const diffViewer = viewer(workingDocument(), {} as ExtensionAPI, () => {
    closes += 1
  })

  diffViewer.focused = true
  assert.equal(diffViewer.focused, true)
  diffViewer.focused = false
  diffViewer.handleInput("?")
  assert.equal(diffViewer.help(), "viewer")
  diffViewer.handleInput("q")
  assert.equal(diffViewer.help(), undefined)
  assert.equal(closes, 0)
  diffViewer.handleInput("q")
  assert.equal(closes, 1)
})

test("historical mode consumes and suppresses every working-tree mutation shortcut", () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("unexpected")
    },
  } as unknown as ExtensionAPI
  const diffViewer = viewer(historicalDocument(), pi)

  for (const input of ["\r", "\x1b[13;2u", "C", "D", "I", "b", "s", "\x10"]) {
    diffViewer.handleInput(input)
  }

  assert.equal(execCalls, 0)
  assert.deepEqual(diffViewer.overlayStates(), ["closed", "closed", "closed", "closed", "closed"])
  diffViewer.clearFeedback()
  const footer = diffViewer.render(240).join("\n")
  assert.match(footer, /\? help • q close • W tree/u)
  assert.match(footer, /c commits/u)
  assert.doesNotMatch(footer, /stage remaining|D discard|C staged review|b branches|w worktrees|s stash|\^P commands/u)

  diffViewer.handleInput("?")
  const help = diffViewer.render(240).join("\n")
  assert.match(help, /Return directly to the working tree/u)
  assert.doesNotMatch(help, /Discard selected|Open the branch picker|Open stash actions|Stage remaining/u)
})

test("direct W returns to working mode and preserves the historical path", async () => {
  const workingDiff = patch("b.ts", "working")
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) =>
      workingSnapshotResult(args, options?.cwd, { workingDiff }) ??
      gitResult("", 91, `unexpected git ${args.join(" ")}`),
  } as ExtensionAPI
  const diffViewer = viewer(historicalDocument(), pi)
  diffViewer.handleInput("\x1b[B")
  assert.equal(diffViewer.selectedPath(), "b.ts")

  diffViewer.handleInput("W")
  await waitForViewerIdle(diffViewer)

  assert.equal(diffViewer.currentMode(), "working")
  assert.equal(diffViewer.selectedPath(), "b.ts")
  assert.equal(diffViewer.picker(), "closed")
  assert.match(diffViewer.render(180).join("\n"), /Viewing working tree/u)
})

test("stale mutation callbacks recheck historical policy before Git execution", async () => {
  let execCalls = 0
  const pi = {
    exec: async () => {
      execCalls += 1
      return gitResult("unexpected")
    },
  } as unknown as ExtensionAPI
  const document = historicalDocument()
  const diffViewer = viewer(document, pi)
  const file = document.mode === "commit" ? document.diff.files[0] : undefined
  assert.ok(file)

  await diffViewer.invokeStaleMutations(file)

  assert.equal(execCalls, 0)
  assert.match(diffViewer.render(180).join("\n"), /Return to the working tree with W/u)
})

test("discard prompts distinguish tracked, untracked, and renamed consequences", () => {
  const cases: Array<{ file: DiffFile; patterns: RegExp[] }> = [
    {
      file: { path: "tracked.ts", status: "modified", stageState: "mixed", lines: [] },
      patterns: [/Path: tracked\.ts/u, /all staged and unstaged changes/u],
    },
    {
      file: { path: "new.ts", status: "added", stageState: "unstaged", untracked: true, lines: [] },
      patterns: [/Path: new\.ts/u, /Permanently removes this untracked file/u],
    },
    {
      file: {
        path: "new-name.ts",
        oldPath: "old-name.ts",
        newPath: "new-name.ts",
        status: "renamed",
        stageState: "mixed",
        lines: [],
      },
      patterns: [/Rename: old-name\.ts → new-name\.ts/u, /both rename paths/u],
    },
  ]

  for (const { file, patterns } of cases) {
    const diffViewer = viewer(workingDocument("/repo", { workingFiles: [file] }))
    diffViewer.handleInput("D")
    const prompt = diffViewer.render(180).join("\n")
    for (const pattern of patterns) {
      assert.match(prompt, pattern)
    }
    assert.match(prompt, /Enter: Discard • Esc: Cancel/u)
    assert.doesNotMatch(prompt, /\[ OK \]|\[ Cancel \]/u)
  }
})

test("discard confirmation uses Enter once and Escape cancels safely", async () => {
  const file: DiffFile = { path: "tracked.ts", status: "modified", stageState: "unstaged", lines: [] }
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) =>
      workingSnapshotResult(args, options?.cwd) ?? gitResult("", 90, `unexpected git ${args.join(" ")}`),
  } as ExtensionAPI
  const cancelled = new ConfirmationViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: [file] }),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
  cancelled.handleInput("D")
  cancelled.handleInput("\x1b")
  assert.equal(cancelled.confirmed, 0)

  const confirmed = new ConfirmationViewer(
    pi,
    { cwd: "/repo" } as ExtensionContext,
    testTheme,
    workingDocument("/repo", { workingFiles: [file] }),
    () => {},
    () => {},
    () => 40,
    testViewerOptions,
  )
  confirmed.handleInput("D")
  confirmed.handleInput("\r")
  confirmed.handleInput("\r")
  await flushViewerWork()
  assert.equal(confirmed.confirmed, 1)
})

test("force push requires a dry-run preview and a second Enter", async () => {
  let dryRuns = 0
  let pushes = 0
  const responses: Record<string, (cwd: string) => ReturnType<typeof gitResult>> = {
    "rev-parse --show-toplevel": (cwd) => gitResult(`${cwd}\n`),
    "push --force-with-lease --dry-run --porcelain": () => {
      dryRuns += 1
      return gitResult(
        "To https://token:secret@example.com/org/repo.git\n+\trefs/heads/main:refs/heads/main\t[forced update]\n",
      )
    },
    "push --force-with-lease": () => {
      pushes += 1
      return gitResult("forced update")
    },
  }
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) => {
      const response = responses[args.join(" ")]
      return response?.(options?.cwd ?? "/repo") ?? workingSnapshotResult(args, options?.cwd) ?? gitResult("", 89)
    },
  } as ExtensionAPI
  const diffViewer = viewer(workingDocument(), pi)
  diffViewer.handleInput("\x10")
  diffViewer.handleInput("force")

  diffViewer.handleInput("\r")
  await flushViewerWork()

  assert.equal(dryRuns, 1)
  assert.equal(pushes, 0)
  assert.equal(diffViewer.commandState(), "confirm")
  const confirmation = diffViewer.render(180).join("\n")
  assert.match(confirmation, /git push --force-with-lease/u)
  assert.match(confirmation, /https:\/\/example\.com\/org\/repo\.git/u)
  assert.match(confirmation, /Enter: Force push • Esc: Cancel/u)

  diffViewer.handleInput("\r")
  diffViewer.handleInput("\r")
  await flushViewerWork()
  assert.equal(pushes, 1)
})

test("failed force-push preview returns to the menu without a real push", async () => {
  let pushes = 0
  const responses: Record<string, (cwd: string) => ReturnType<typeof gitResult>> = {
    "rev-parse --show-toplevel": (cwd) => gitResult(`${cwd}\n`),
    "push --force-with-lease --dry-run --porcelain": () => gitResult("", 1, "fatal: no upstream configured"),
    "push --force-with-lease": () => {
      pushes += 1
      return gitResult()
    },
  }
  const pi = {
    exec: async (_command: string, args: string[], options?: ExecOptions) =>
      responses[args.join(" ")]?.(options?.cwd ?? "/repo") ?? gitResult(),
  } as ExtensionAPI
  const diffViewer = viewer(workingDocument(), pi)
  diffViewer.handleInput("\x10")
  diffViewer.handleInput("force")
  diffViewer.handleInput("\r")
  await flushViewerWork()

  assert.equal(pushes, 0)
  assert.equal(diffViewer.commandState(), "open")
  assert.match(diffViewer.render(180).join("\n"), /no upstream configured/u)
})
