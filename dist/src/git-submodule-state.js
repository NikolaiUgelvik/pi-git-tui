export function isSubmoduleState(value) {
    return value?.startsWith("S") ?? false;
}
export function hasNestedSubmoduleChanges(value) {
    return isSubmoduleState(value) && (value?.[2] === "M" || value?.[3] === "U");
}
function entryMatchesPath(entry, path) {
    return entry.path === path || entry.originalPath === path;
}
export function submoduleStateForPath(snapshot, path) {
    return snapshot.entries.find((entry) => entryMatchesPath(entry, path))?.submodule;
}
//# sourceMappingURL=git-submodule-state.js.map