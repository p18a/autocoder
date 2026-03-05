export interface Project {
	id: string;
	name: string;
	path: string;
	createdAt: string;
	updatedAt: string;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TaskType = "discovery" | "execution";

export interface Task {
	id: string;
	projectId: string;
	title: string | null;
	prompt: string;
	status: TaskStatus;
	taskType: TaskType;
	originTaskId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TaskLog {
	id: string;
	taskId: string;
	content: string;
	stream: "stdout" | "stderr" | "system";
	createdAt: string;
}

export interface Config {
	key: string;
	value: string;
}

// --- Dev Journal ---

export type JournalTier = "recent" | "summary" | "historical";

export interface JournalEntry {
	id: string;
	projectId: string;
	content: string;
	tier: JournalTier;
	createdAt: string;
}

// --- Server Logging ---

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSource = "server" | "ws" | "orchestrator" | "db" | "git";

export interface ServerLog {
	id: string;
	level: LogLevel;
	source: LogSource;
	message: string;
	meta: string | null;
	createdAt: string;
}

// --- WebSocket Messages ---

// Client → Server
export type ClientMessage = (
	| { type: "create_project"; name: string; path: string }
	| { type: "delete_project"; projectId: string }
	| { type: "add_task"; projectId: string; prompt: string }
	| { type: "cancel_task"; taskId: string }
	| { type: "remove_task"; taskId: string }
	| { type: "retry_task"; taskId: string }
	| { type: "get_task_logs"; taskId: string; limit?: number; before?: string }
	| { type: "set_config"; key: string; value: string }
	| { type: "start_project"; projectId: string; mode: "discover" | "execute" }
	| { type: "stop_project"; projectId: string }
	| { type: "get_server_logs"; limit?: number; level?: LogLevel }
) & { commandId?: string };

// Server → Client
export type ServerMessage =
	| { type: "init"; projects: Project[]; tasks: Task[]; config: Config[] }
	| { type: "project_created"; project: Project }
	| { type: "project_deleted"; projectId: string }
	| { type: "task_added"; task: Task }
	| { type: "task_updated"; task: Task }
	| { type: "task_removed"; taskId: string }
	| { type: "task_log"; log: TaskLog }
	| { type: "task_logs"; taskId: string; logs: TaskLog[]; total: number; hasMore: boolean }
	| { type: "config_updated"; config: Config }
	| { type: "error"; message: string; commandId?: string }
	| { type: "ack"; commandId: string }
	| { type: "server_log"; log: ServerLog }
	| { type: "server_logs"; logs: ServerLog[] };
