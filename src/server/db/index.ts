// Initialize schema and run migrations (side-effect import)
import "./schema.ts";

// Config
export { getConfig, getProjectConfig, listConfig, setConfig, setProjectConfig } from "./config.ts";
// Journal
export {
	appendJournalEntry,
	clearJournalTier,
	getJournalEntries,
	getJournalEntriesByTier,
	getJournalEntryCount,
	getOldestRecentEntries,
	getOldestSummaryEntries,
	removeJournalEntry,
	searchJournalEntries,
} from "./journal.ts";
// Projects
export { createProject, deleteProject, deleteProjectCascade, getProject, listProjects } from "./projects.ts";
// Server Logs
export {
	getServerLogCount,
	getServerLogs,
	getServerLogsByLevel,
	insertServerLog,
	pruneServerLogs,
} from "./serverLogs.ts";
// Task Logs
export { appendTaskLog, getTaskLogCount, getTaskLogs } from "./taskLogs.ts";
// Tasks
export {
	createTask,
	getQueuedTasks,
	getQueuedTasksByProject,
	getRunningTasksByProject,
	getTask,
	listTasks,
	removeTask,
	updateTask,
} from "./tasks.ts";
