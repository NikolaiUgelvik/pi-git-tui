import gitDiffExtension from "../extensions/diff.js"

const extensionFactory: unknown = gitDiffExtension

if (typeof extensionFactory !== "function") {
  throw new TypeError("diff extension must export a Pi extension factory")
}
