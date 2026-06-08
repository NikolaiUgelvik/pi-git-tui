// Re-export from focused service modules
export {
  generateCommitMessage,
  runGitCommit,
} from "./commit-message-service.js"
export { runGitCommand } from "./git-command-service.js"
export { loadCommitDiff, loadWorkingTreeDiff } from "./git-diff-service.js"

export { loadCommits } from "./git-history-service.js"
export { stageOrUnstageFile, toggleAllChangesStaged } from "./git-index-service.js"
