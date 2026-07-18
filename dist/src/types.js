export const COMMIT_LIMIT = 200;
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
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Pull",
        description: "Pull updates into the current branch",
        args: ["pull"],
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Pull (Rebase)",
        description: "Pull updates and rebase local commits",
        args: ["pull", "--rebase"],
        refresh: { success: "full", failure: "full" },
    },
    {
        label: "Push",
        description: "Push the current branch",
        args: ["push"],
        refresh: { success: "status", failure: "status" },
    },
    {
        label: "Force Push",
        description: "Push the current branch with --force-with-lease",
        args: ["push", "--force-with-lease"],
        refresh: { success: "status", failure: "status" },
    },
];
//# sourceMappingURL=types.js.map