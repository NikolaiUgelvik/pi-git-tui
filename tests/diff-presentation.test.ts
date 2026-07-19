import assert from "node:assert/strict"
import { test } from "node:test"
import type { Theme } from "@earendil-works/pi-coding-agent"
import { slicePreparedColumns } from "../src/ansi-segments.js"
import { type PreparedDiffDisplay, prepareDiffPresentation } from "../src/diff-presentation.js"
import { DIFF_SYNTAX_LIMITS, type SyntaxHighlighting } from "../src/diff-syntax.js"
import type { DiffFile } from "../src/types.js"
import {
  stripTestAnsi as plain,
  testSgrPattern as sgr,
  diffHighlightTheme as theme,
} from "./helpers/diff-highlighting.js"

function diffFile(path: string, lines: string[], extra: Partial<DiffFile> = {}): DiffFile {
  return { path, status: "modified", lines, ...extra }
}

function patch(path: string, hunkLines: readonly string[]): string[] {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1,3 +1,3 @@", ...hunkLines]
}

function rowContent(display: PreparedDiffDisplay, type: "context" | "addition" | "deletion", occurrence = 0): string {
  const row = display.rows.filter((candidate) => candidate.semantic.type === type)[occurrence]
  assert.ok(row)
  return slicePreparedColumns(row.content, 0, row.content.width)
}

function recordingSyntax(language: (path: string) => string | undefined) {
  const paths: string[] = []
  const calls: { code: string; language: string }[] = []
  const syntax: SyntaxHighlighting = {
    languageFromPath: (path) => {
      paths.push(path)
      return language(path)
    },
    highlight: (code, selectedLanguage) => {
      calls.push({ code, language: selectedLanguage })
      return code.split("\n").map((line) => `\x1b[34m${line}\x1b[39m`)
    },
  }
  return { syntax, paths, calls }
}

test("side-specific language resolution covers rename, copy, add, delete, and nested Dockerfile", () => {
  const cases: { file: DiffFile; expected: string[] }[] = [
    {
      file: diffFile("src/new.ts", patch("src/new.ts", ["+newValue"]), { status: "added", newPath: "src/new.ts" }),
      expected: ["typescript"],
    },
    {
      file: diffFile("src/old.js", patch("src/old.js", ["-oldValue"]), { status: "deleted", oldPath: "src/old.js" }),
      expected: ["javascript"],
    },
    {
      file: diffFile("src/new.ts", patch("src/new.ts", ["-oldValue", "+newValue"]), {
        status: "renamed",
        oldPath: "src/old.js",
        newPath: "src/new.ts",
      }),
      expected: ["javascript", "typescript"],
    },
    {
      file: diffFile("src/copy.ts", patch("src/copy.ts", ["-oldValue", "+newValue"]), {
        status: "copied",
        oldPath: "src/source.js",
        newPath: "src/copy.ts",
      }),
      expected: ["javascript", "typescript"],
    },
    {
      file: diffFile("docker/Dockerfile", patch("docker/Dockerfile", ["-FROM old", "+FROM next"])),
      expected: ["dockerfile", "dockerfile"],
    },
  ]

  for (const entry of cases) {
    const recorder = recordingSyntax((path) => {
      if (path === "Dockerfile") return "dockerfile"
      if (path.endsWith(".ts")) return "typescript"
      return path.endsWith(".js") ? "javascript" : undefined
    })
    prepareDiffPresentation(entry.file, theme, recorder.syntax)
    assert.deepEqual(
      recorder.calls.map((call) => call.language),
      entry.expected,
    )
    if (entry.file.path.endsWith("Dockerfile")) {
      assert.deepEqual(recorder.paths.slice(0, 2), ["docker/Dockerfile", "Dockerfile"])
    }
  }
})

test("hunk streams are reconstructed exactly and preserve multiline lexical state", () => {
  const calls: string[] = []
  const syntax: SyntaxHighlighting = {
    languageFromPath: () => "typescript",
    highlight: (code) => {
      calls.push(code)
      let inComment = false
      return code.split("\n").map((line) => {
        if (line.includes("/*")) inComment = true
        const highlighted = inComment ? `\x1b[33m${line}\x1b[39m` : line
        if (line.includes("*/")) inComment = false
        return highlighted
      })
    },
  }
  const file = diffFile("state.ts", patch("state.ts", [" /* comment", "-old token", "+new token", " */"]))
  const display = prepareDiffPresentation(file, theme, syntax)

  assert.deepEqual(calls, ["/* comment\nold token\n*/", "/* comment\nnew token\n*/"])
  assert.match(rowContent(display, "deletion"), sgr("[^m]*33[^m]*m"))
  assert.match(rowContent(display, "addition"), sgr("[^m]*33[^m]*m"))
})

test("context rows prefer new-side syntax and hunks highlight independently", () => {
  const calls: { code: string; language: string }[] = []
  const syntax: SyntaxHighlighting = {
    languageFromPath: (path) => (path.endsWith(".js") ? "old" : "new"),
    highlight: (code, language) => {
      calls.push({ code, language })
      const color = language === "new" ? 34 : 33
      return code.split("\n").map((line) => `\x1b[${color}m${line}\x1b[39m`)
    },
  }
  const lines = ["@@ -1,2 +1,2 @@", " shared", "-old", "+new", "@@ -10 +10 @@", " second"]
  const file = diffFile("next.ts", lines, { status: "renamed", oldPath: "before.js", newPath: "next.ts" })
  const display = prepareDiffPresentation(file, theme, syntax)

  assert.equal(calls.length, 4)
  assert.match(rowContent(display, "context", 0), sgr("[^m]*34m"))
  assert.match(rowContent(display, "context", 1), sgr("[^m]*34m"))
})

test("conflict markers split syntax segments and keep dedicated conflict styling", () => {
  const calls: string[] = []
  const syntax: SyntaxHighlighting = {
    languageFromPath: () => "typescript",
    highlight: (code) => {
      calls.push(code)
      return code.split("\n")
    },
  }
  const file = diffFile("conflict.ts", [
    "@@ -1,3 +1,5 @@",
    " before",
    "+<<<<<<< ours",
    "+ours",
    "+=======",
    "+theirs",
    "+>>>>>>> theirs",
    " after",
  ])
  const display = prepareDiffPresentation(file, theme, syntax)

  assert.deepEqual(calls, ["before", "before", "ours", "theirs", "after", "after"])
  const boundary = rowContent(display, "addition", 0)
  const separator = rowContent(display, "addition", 2)
  assert.match(boundary, sgr("[^m]*1[^m]*91[^m]*42m"))
  assert.match(separator, sgr("[^m]*1[^m]*93[^m]*42m"))
})

test("changed spans retain syntax foregrounds over a stronger row-specific background", () => {
  const layeredTheme = {
    ...theme,
    getFgAnsi: (color: string) => {
      if (color === "toolDiffAdded") return "\x1b[38;2;150;180;100m"
      if (color === "toolDiffRemoved") return "\x1b[38;2;200;100;100m"
      return theme.getFgAnsi(color as never)
    },
    getBgAnsi: (color: string) => {
      if (color === "toolSuccessBg") return "\x1b[48;2;40;50;40m"
      if (color === "toolErrorBg") return "\x1b[48;2;60;40;40m"
      return theme.getBgAnsi(color as never)
    },
  } as unknown as Theme
  const syntax: SyntaxHighlighting = {
    languageFromPath: () => "typescript",
    highlight: (code) => code.split("\n").map((line) => `\x1b[38;2;100;150;220m${line}\x1b[39m`),
  }
  const display = prepareDiffPresentation(
    diffFile("change.ts", ["@@ -1 +1 @@", "-const oldName = 1", "+const newName = 1"]),
    layeredTheme,
    syntax,
  )
  const deletion = rowContent(display, "deletion")
  const addition = rowContent(display, "addition")

  assert.match(deletion, sgr("38;2;100;150;220;48;2;60;40;40mconst "))
  assert.match(addition, sgr("38;2;100;150;220;48;2;40;50;40mconst "))
  assert.match(deletion, sgr("1;38;2;100;150;220;48;2;102;58;58mold"))
  assert.match(addition, sgr("1;38;2;100;150;220;48;2;73;89;58mnew"))
  assert.doesNotMatch(deletion, sgr("[^m]*38;2;200;100;100m"))
  assert.doesNotMatch(addition, sgr("[^m]*38;2;150;180;100m"))
  assert.equal(plain(deletion), "const oldName = 1")
  assert.equal(plain(addition), "const newName = 1")
})

test("binary, omission, malformed-only, and unsupported-language files use plain mode", () => {
  const unsupported = recordingSyntax(() => undefined)
  const entries: DiffFile[] = [
    diffFile("image.png", ["Binary files a/image.png and b/image.png differ"], { status: "binary" }),
    diffFile("omitted.ts", [], { omission: { reason: "file-too-large", message: "too large" } }),
    diffFile("broken.ts", ["@@ malformed", "+not parsed"]),
    diffFile("notes.unknown", ["@@ -1 +1 @@", "-old", "+new"]),
  ]
  for (const file of entries) {
    const display = prepareDiffPresentation(file, theme, unsupported.syntax)
    assert.equal(display.mode, "plain")
    assert.equal(display.highlighterCalls, 0)
  }
})

test("thrown, wrong-count, altered-text, and non-SGR highlighter failures stay localized", () => {
  const failures: SyntaxHighlighting["highlight"][] = [
    () => {
      throw new Error("broken")
    },
    () => [],
    (code) => code.split("\n").map((line) => `${line}!`),
    (code) => code.split("\n").map((line) => `\x1b]8;;bad\x07${line}`),
  ]
  for (const highlight of failures) {
    const display = prepareDiffPresentation(diffFile("failure.ts", ["@@ -1 +1 @@", "-old", "+new"]), theme, {
      languageFromPath: () => "typescript",
      highlight,
    })
    assert.equal(plain(rowContent(display, "deletion")), "old")
    assert.equal(plain(rowContent(display, "addition")), "new")
    assert.equal(display.mode, "rich")
  }
})

test("normalization happens before syntax and sanitizes raw terminal controls", () => {
  const calls: string[] = []
  const syntax: SyntaxHighlighting = {
    languageFromPath: () => "typescript",
    highlight: (code) => {
      calls.push(code)
      return code.split("\n")
    },
  }
  const display = prepareDiffPresentation(
    diffFile("safe.ts", ["@@ -1 +1 @@", "-old\tvalue\x1b", "+new\tvalue\x07"]),
    theme,
    syntax,
  )

  assert.deepEqual(calls, ["old    value\\x1b", "new    value\\x07"])
  assert.equal(plain(rowContent(display, "deletion")), "old    value\\x1b")
  assert.equal(plain(rowContent(display, "addition")), "new    value\\x07")
})

test("syntax limits remain fixed", () => {
  assert.deepEqual(DIFF_SYNTAX_LIMITS, {
    richCodeRowsPerFile: 10_000,
    normalizedCodeBytesPerFile: 512 * 1024,
    hunksPerFile: 256,
    linesPerSideSegment: 4_096,
    bytesPerSideSegment: 256 * 1024,
    retainedGeneratedAnsiPerFile: 2 * 1024 * 1024,
  })
})

test("rich file limits disable syntax and intraline deterministically", () => {
  const syntax = recordingSyntax(() => "typescript")
  const oversized = "x".repeat(512 * 1024 + 1)
  const display = prepareDiffPresentation(
    diffFile("huge.ts", ["@@ -1 +1 @@", `-${oversized}`, `+${oversized.slice(0, -1)}y`]),
    theme,
    syntax.syntax,
  )

  assert.equal(display.mode, "plain")
  assert.equal(display.highlighterCalls, 0)
  assert.equal(syntax.calls.length, 0)
})

test("no-color themes preserve plain content without leaked syntax foregrounds", () => {
  const noColor = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
  } as unknown as Theme
  const display = prepareDiffPresentation(diffFile("plain.ts", ["@@ -1 +1 @@", "-old", "+new"]), noColor, {
    languageFromPath: () => "typescript",
    highlight: (code) => code.split("\n").map((line) => `\x1b[34m${line}\x1b[39m`),
  })

  assert.equal(rowContent(display, "deletion"), "\x1b[1mold\x1b[0m")
  assert.equal(rowContent(display, "addition"), "\x1b[1mnew\x1b[0m")
})
