import { toast } from "sonner";
import type { ServerMessage } from "../../shared/types.ts";
import { useConfigStore } from "./config.ts";
import { useConnectionStore } from "./connection.ts";
import { useJournalStore } from "./journal.ts";
import { useServerLogsStore } from "./serverLogs.ts";
import { useProjectsStore } from "./sessions.ts";
import { useTasksStore } from "./tasks.ts";

export function handleServerMessage(msg: ServerMessage) {
	switch (msg.type) {
		case "init":
			useProjectsStore.getState().setProjects(msg.projects);
			useTasksStore.getState().setTasks(msg.tasks);
			useConfigStore.getState().setConfigs(msg.config);
			useConnectionStore.setState({ initialized: true });
			break;
		case "project_created":
			useProjectsStore.getState().upsertProject(msg.project);
			break;
		case "project_deleted":
			useProjectsStore.getState().removeProject(msg.projectId);
			useTasksStore.getState().removeTasksByProject(msg.projectId);
			useConfigStore.getState().removeConfigsByProject(msg.projectId);
			break;
		case "task_added":
			useTasksStore.getState().upsertTask(msg.task);
			break;
		case "task_updated":
			useTasksStore.getState().upsertTask(msg.task);
			break;
		case "task_removed":
			useTasksStore.getState().removeTask(msg.taskId);
			break;
		case "task_log":
			useTasksStore.getState().appendLog(msg.log);
			break;
		case "task_logs": {
			const store = useTasksStore.getState();
			const existing = store.logs[msg.taskId];
			// If the client already has logs and the new batch ends before the existing first log,
			// this is a "load more" (prepend older logs). Otherwise replace.
			if (existing && existing.length > 0 && msg.logs.length > 0) {
				const existingFirst = existing[0];
				const newLast = msg.logs[msg.logs.length - 1];
				if (!existingFirst || !newLast) break;
				const existingFirstId = existingFirst.id;
				const newLastId = newLast.id;
				if (newLastId < existingFirstId) {
					store.prependLogs(msg.taskId, msg.logs, msg.total, msg.hasMore);
					break;
				}
			}
			store.setLogs(msg.taskId, msg.logs, msg.total, msg.hasMore);
			break;
		}
		case "config_updated":
			useConfigStore.getState().setConfig(msg.config);
			break;
		case "server_log":
			useServerLogsStore.getState().appendLog(msg.log);
			break;
		case "server_logs":
			useServerLogsStore.getState().setLogs(msg.logs);
			break;
		case "journal_entries":
			useJournalStore.getState().setEntries(msg.projectId, msg.entries);
			break;
		case "error":
			toast.error(msg.commandId ? `Error (Cmd: ${msg.commandId}): ${msg.message}` : msg.message);
			break;
		case "ack":
			// No-op for now, but could be used to resolve promises
			break;
	}
}
