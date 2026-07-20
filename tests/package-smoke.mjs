import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-git-tui-package-smoke-"))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed (${result.signal ?? result.status})`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return result.stdout
}

function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) return { command: process.execPath, args: [npmExecPath, ...args] }
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args }
}

function spawnNpm(args, cwd) {
  const invocation = npmInvocation(args)
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  })
}

function runNpm(args, cwd = root) {
  const invocation = npmInvocation(args)
  return run(invocation.command, invocation.args, { cwd })
}

function copyGitCheckout(name = "git-checkout") {
  const checkout = join(temporaryRoot, name)
  mkdirSync(checkout)
  for (const directory of ["assets", "dist", "extensions", "scripts", "src"]) {
    cpSync(join(root, directory), join(checkout, directory), { recursive: true })
  }
  for (const file of [
    ".gitattributes",
    "README.md",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ]) {
    cpSync(join(root, file), join(checkout, file))
  }
  return checkout
}

function assertReproducibleBuildGate() {
  const compilerCheckout = copyGitCheckout("wrong-compiler")
  symlinkSync(
    join(root, "node_modules"),
    join(compilerCheckout, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  const compilerManifestPath = join(compilerCheckout, "dist/build-manifest.json")
  const compilerManifest = JSON.parse(readFileSync(compilerManifestPath, "utf8"))
  compilerManifest.compiler = "typescript@0.0.0"
  writeFileSync(compilerManifestPath, `${JSON.stringify(compilerManifest, null, 2)}\n`)
  const compilerResult = spawnSync(process.execPath, [join(compilerCheckout, "scripts/verify-build.mjs")], {
    cwd: compilerCheckout,
    encoding: "utf8",
  })
  assert.notEqual(compilerResult.status, 0, "verify-build accepted a false compiler identity")
  assert.match(`${compilerResult.stdout}\n${compilerResult.stderr}`, /does not match locked TypeScript/u)

  const staleCheckout = copyGitCheckout("forged-stale-output")
  symlinkSync(
    join(root, "node_modules"),
    join(staleCheckout, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  const staleOutputPath = join(staleCheckout, "dist/src/extension.js")
  writeFileSync(staleOutputPath, `${readFileSync(staleOutputPath, "utf8")}\n// forged stale output\n`)
  const manifestPath = join(staleCheckout, "dist/build-manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const record = manifest.outputs.find(({ path }) => path === "dist/src/extension.js")
  assert(record, "build manifest lacks dist/src/extension.js")
  const contents = readFileSync(staleOutputPath)
  record.bytes = contents.byteLength
  record.sha256 = createHash("sha256").update(contents).digest("hex")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const staleResult = spawnSync(process.execPath, [join(staleCheckout, "scripts/verify-build.mjs")], {
    cwd: staleCheckout,
    encoding: "utf8",
  })
  assert.notEqual(staleResult.status, 0, "verify-build accepted self-attested stale output")
  assert.match(`${staleResult.stdout}\n${staleResult.stderr}`, /canonical clean build differs/u)
}

function importCompiledEntry(checkout) {
  const entryUrl = pathToFileURL(join(checkout, "dist/extensions/diff.js")).href
  return spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(entryUrl)})`], {
    cwd: checkout,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
}

function assertGitInstallSemantics() {
  const checkout = copyGitCheckout()
  const installArgs = ["install", "--omit=dev", "--no-audit", "--no-fund"]
  runNpm(installArgs, checkout)
  assert(!existsSync(join(checkout, "node_modules/typescript")), "production git install included TypeScript")

  const extensionPath = join(checkout, "dist/src/extension.js")
  const originalExtension = readFileSync(extensionPath, "utf8")
  const sideEffectPath = join(checkout, "stale-module-evaluated")
  writeFileSync(
    extensionPath,
    `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(sideEffectPath)}, "yes")\n${originalExtension}`,
  )
  const staleImport = importCompiledEntry(checkout)
  assert.notEqual(staleImport.status, 0, "compiled entry imported modified output")
  assert.match(
    `${staleImport.stdout}\n${staleImport.stderr}`,
    /refused to load missing or inconsistent compiled output/,
  )
  assert(!existsSync(sideEffectPath), "stale dependency executed before build verification")

  writeFileSync(extensionPath, originalExtension)
  rmSync(extensionPath)
  const missingImport = importCompiledEntry(checkout)
  assert.notEqual(missingImport.status, 0, "compiled entry imported with a missing dependency")
  const missingOutput = `${missingImport.stdout}\n${missingImport.stderr}`
  assert.match(missingOutput, /refused to load missing or inconsistent compiled output/)
  assert.doesNotMatch(missingOutput, /ERR_MODULE_NOT_FOUND/)
  writeFileSync(extensionPath, originalExtension)

  const changedSource = join(checkout, "src/extension.ts")
  writeFileSync(changedSource, `${readFileSync(changedSource, "utf8")}\n// stale checkout probe\n`)
  const staleInstall = spawnNpm(installArgs, checkout)
  assert.notEqual(staleInstall.status, 0, "production git install accepted stale output")
  assert.match(`${staleInstall.stdout}\n${staleInstall.stderr}`, /compiled output is missing or stale/)
}

function collectRelativeFiles(directory, prefix = "") {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...collectRelativeFiles(join(directory, entry.name), relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

function directorySnapshot(directory) {
  return collectRelativeFiles(directory).map((file) => {
    const contents = readFileSync(join(directory, file))
    return [file, createHash("sha256").update(contents).digest("hex")]
  })
}

function assertDirectoriesEqual(left, right) {
  const leftFiles = collectRelativeFiles(left)
  const rightFiles = collectRelativeFiles(right)
  assert.deepEqual(rightFiles, leftFiles, "rebuilt package output file list differs from checked dist")
  for (const file of leftFiles) {
    assert.deepEqual(
      readFileSync(join(right, file)),
      readFileSync(join(left, file)),
      `rebuilt package output differs from checked dist: ${file}`,
    )
  }
}

function assertProductionPath(file) {
  const expectedRootFile = file === "package.json" || file === "README.md"
  assert(expectedRootFile || file.startsWith("assets/") || file.startsWith("dist/"), `unexpected file: ${file}`)
  assert(!file.startsWith("dist/tests/"), `production build emitted a test: ${file}`)
}

function assertJavaScriptArtifact(packageRoot, files, file) {
  assert(files.includes(`${file}.map`), `installed tarball is missing ${file}.map`)
  const sourceMap = JSON.parse(readFileSync(join(packageRoot, `${file}.map`), "utf8"))
  assert.equal(sourceMap.sourcesContent?.length, sourceMap.sources?.length, `${file}.map lacks inline sources`)
  assert(sourceMap.sourcesContent.every((source) => typeof source === "string" && source.length > 0))
  assert(sourceMap.sources.every((source) => !isAbsolute(source) && !source.includes("/tests/")))
}

function assertInstalledContents(packageRoot) {
  const files = collectRelativeFiles(packageRoot)
  assert(files.includes("package.json"), "installed tarball is missing package.json")
  assert(files.includes("README.md"), "installed tarball is missing README.md")
  assert(files.includes("assets/banner.png"), "installed tarball is missing its README banner")
  assert(files.includes("dist/build-manifest.json"), "installed tarball is missing its build manifest")
  assert(files.includes("dist/extensions/diff.js"), "installed tarball is missing the emitted Pi entry")
  assert(files.includes("dist/extensions/diff.d.ts"), "installed tarball is missing exported declarations")

  for (const file of files) assertProductionPath(file)

  const javascriptFiles = files.filter((file) => file.endsWith(".js"))
  const declarationFiles = files.filter((file) => file.endsWith(".d.ts"))
  assert(javascriptFiles.length > 0, "installed tarball contains no JavaScript")
  assert.equal(javascriptFiles.length, declarationFiles.length, "JavaScript/declaration counts differ")
  for (const file of javascriptFiles) assertJavaScriptArtifact(packageRoot, files, file)
  assert.equal(
    files.some((file) => file.endsWith(".d.ts.map")),
    false,
    "installed tarball contains declaration maps whose sources are not published",
  )
}

function linkHostPeers(consumerDirectory) {
  const peerScope = join(consumerDirectory, "node_modules/@earendil-works")
  mkdirSync(peerScope, { recursive: true })
  for (const packageName of ["pi-coding-agent", "pi-tui"]) {
    const source = join(root, "node_modules/@earendil-works", packageName)
    const target = join(peerScope, packageName)
    assert(existsSync(source), `missing host peer ${packageName}`)
    symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir")
  }
}

function assertActualLocalPiInstall(packageRoot) {
  const project = join(temporaryRoot, "pi-local-install")
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), '{"name":"pi-local-install","private":true}\n')
  const piCommand = join(root, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi")
  run(piCommand, ["install", packageRoot, "-l"], { cwd: project })
  const settingsPath = join(project, ".pi/settings.json")
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  const settingsDirectory = dirname(settingsPath)
  assert.equal(
    settings.packages?.some((entry) => {
      const source = typeof entry === "string" ? entry : entry?.source
      return typeof source === "string" && resolve(settingsDirectory, source) === packageRoot
    }),
    true,
    "pi install did not record the local packed package",
  )
}

async function assertPackageLoads(packageRoot) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  assert.deepEqual(packageJson.files, ["dist", "assets", "README.md"])
  assert.deepEqual(packageJson.pi?.extensions, ["./dist/extensions/diff.js"])
  assert.equal(packageJson.exports?.["."]?.import, "./dist/extensions/diff.js")
  assert.equal(packageJson.exports?.["."]?.types, "./dist/extensions/diff.d.ts")

  const entryPath = join(packageRoot, packageJson.pi.extensions[0])
  const agentDirectory = join(temporaryRoot, "agent")
  mkdirSync(agentDirectory, { recursive: true })
  const loaded = await discoverAndLoadExtensions([entryPath], temporaryRoot, agentDirectory)
  assert.deepEqual(loaded.errors, [])
  assert.equal(loaded.extensions.length, 1)

  const extension = loaded.extensions[0]
  const command = extension?.commands.get("diff")
  const expectedShortcut = process.platform === "darwin" ? "super+shift+g" : "ctrl+shift+g"
  const shortcut = extension?.shortcuts.get(expectedShortcut)
  assert(command, "packed extension did not register /diff")
  assert(shortcut, `packed extension did not register ${expectedShortcut}`)

  const notifications = []
  const context = {
    hasUI: false,
    ui: {
      notify(message, level) {
        notifications.push({ message, level })
      },
    },
  }
  await command.handler("", context)
  await shortcut.handler(context)
  assert.deepEqual(notifications, [
    { message: "/diff requires interactive mode", level: "error" },
    { message: "/diff requires interactive mode", level: "error" },
  ])
}

const checkedDistSnapshot = directorySnapshot(join(root, "dist"))

try {
  assertReproducibleBuildGate()
  assertGitInstallSemantics()

  const packDirectory = join(temporaryRoot, "pack")
  mkdirSync(packDirectory)
  const packCheckout = copyGitCheckout("pack-checkout")
  symlinkSync(
    join(root, "node_modules"),
    join(packCheckout, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  runNpm(["run", "prepack", "--silent"], packCheckout)
  assertDirectoriesEqual(join(root, "dist"), join(packCheckout, "dist"))
  runNpm(["pack", "--ignore-scripts", "--silent", "--pack-destination", packDirectory], packCheckout)
  const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith(".tgz"))
  assert.equal(tarballs.length, 1, "npm pack did not produce exactly one tarball")
  const tarballPath = join(packDirectory, tarballs[0])

  const consumerDirectory = join(temporaryRoot, "consumer")
  mkdirSync(consumerDirectory)
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "pi-git-tui-package-smoke", private: true, type: "module" }, null, 2)}\n`,
  )
  runNpm(
    ["install", "--no-audit", "--no-fund", "--no-package-lock", "--legacy-peer-deps", tarballPath],
    consumerDirectory,
  )
  linkHostPeers(consumerDirectory)

  const exported = JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const extension = await import("pi-git-tui"); process.stdout.write(JSON.stringify({ factory: typeof extension.default, shortcut: extension.getDiffShortcut("darwin") }))',
      ],
      { cwd: consumerDirectory },
    ),
  )
  assert.deepEqual(exported, { factory: "function", shortcut: "super+shift+g" })

  const packageRoot = join(consumerDirectory, "node_modules/pi-git-tui")
  assertInstalledContents(packageRoot)
  assertActualLocalPiInstall(packageRoot)
  await assertPackageLoads(packageRoot)
  console.log("Packed pi-git-tui artifact exported, registered, and invoked /diff plus its shortcut successfully.")
} finally {
  assert.deepEqual(directorySnapshot(join(root, "dist")), checkedDistSnapshot, "package smoke mutated checked dist")
  rmSync(temporaryRoot, { recursive: true, force: true })
}
