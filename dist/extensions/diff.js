import { assertCompiledBuildIsConsistent } from "../src/build-freshness.js";
assertCompiledBuildIsConsistent(import.meta.url);
const extension = await import("../src/extension.js");
export const getDiffShortcut = extension.getDiffShortcut;
export default extension.default;
//# sourceMappingURL=diff.js.map