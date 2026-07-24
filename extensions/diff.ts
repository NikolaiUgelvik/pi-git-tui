import { assertCompiledBuildIsConsistent } from "../src/build-freshness.js"

assertCompiledBuildIsConsistent(import.meta.url)

const extension = await import("../src/extension.js")

export default extension.default
