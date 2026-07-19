export const COMMIT_LIMIT = 200;
export const GIT_TIMEOUT_MS = 10_000;
export const COMMIT_MESSAGE_TIMEOUT_MS = 60_000;
export const MAX_UNTRACKED_FILE_BYTES = 256 * 1024;
export const TREE_STATUS_COLORS = {
    added: "success",
    deleted: "error",
    renamed: "warning",
    copied: "warning",
    binary: "muted",
    conflicted: "warning",
    modified: "text",
};
export const GIT_COMMANDS = [
    {
        label: "Fetch",
        description: "Fetch updates from the default remote",
        args: ["fetch"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Fetch + Prune",
        description: "Fetch the default remote and prune stale remote-tracking refs",
        args: ["fetch", "--prune"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Fetch All Remotes",
        description: "Fetch every remote and prune stale remote-tracking refs",
        args: ["fetch", "--all", "--prune"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Pull (FF Only)",
        description: "Update the current branch only with a fast-forward",
        args: ["pull", "--ff-only"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Pull",
        description: "Pull updates into the current branch",
        args: ["pull"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Pull (Rebase)",
        description: "Pull updates and rebase local commits",
        args: ["pull", "--rebase"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Update Submodules",
        description: "Initialize and recursively update registered submodules",
        args: ["submodule", "update", "--init", "--recursive"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Push",
        description: "Push the current branch",
        args: ["push"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Push Tags",
        description: "Push all local tags to the configured push remote",
        args: ["push", "--tags"],
        risk: { kind: "normal" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Force Push",
        description: "Push the current branch with --force-with-lease",
        args: ["push", "--force-with-lease"],
        risk: { kind: "force-push" },
        refreshDiff: true,
        refresh: { success: "status", failure: "status" },
    },
];
//# sourceMappingURL=types.js.map