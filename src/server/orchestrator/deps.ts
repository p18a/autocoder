import type { Config, Project, ServerMessage, Task, TaskLog, TaskStatus, TaskType } from "../../shared/types.ts";

export interface OrchestratorDeps {
	db: {
		getProject(id: string): Project | null;
		listProjects(): Project[];
		createTask(
			projectId: string,
			prompt: string,
			taskType?: TaskType,
			originTaskId?: string | null,
			title?: string | null,
		): Task;
		getTask(id: string): Task | null;
		listTasks(projectId?: string): Task[];
		updateTask(id: string, status: TaskStatus, expectedStatus?: TaskStatus): Task | null;
		getQueuedTasks(): Task[];
		getQueuedTasksByProject(projectId: string): Task[];
		getRunningTasksByProject(projectId: string): Task[];
		appendTaskLog(taskId: string, content: string, stream?: "stdout" | "stderr" | "system"): TaskLog;
		getProjectConfig(projectId: string, key: string): string | null;
		setProjectConfig(projectId: string, key: string, value: string): Config;
	};
	broadcast(message: ServerMessage): void;
}

export async function createDefaultDeps(): Promise<OrchestratorDeps> {
	// Dynamic imports to avoid circular dependency (orchestrator → ws → handlers → orchestrator)
	const [db, ws, mcp] = await Promise.all([
		import("../db/index.ts"),
		import("../ws.ts"),
		import("../../mcp/server.ts"),
	]);

	// Wire up the MCP broadcast hook so MCP tool calls (e.g. add_task) push real-time updates to WS clients
	mcp.setBroadcastHook(ws.broadcast);

	return {
		db: {
			getProject: db.getProject,
			listProjects: db.listProjects,
			createTask: db.createTask,
			getTask: db.getTask,
			listTasks: db.listTasks,
			updateTask: db.updateTask,
			getQueuedTasks: db.getQueuedTasks,
			getQueuedTasksByProject: db.getQueuedTasksByProject,
			getRunningTasksByProject: db.getRunningTasksByProject,
			appendTaskLog: db.appendTaskLog,
			getProjectConfig: db.getProjectConfig,
			setProjectConfig: db.setProjectConfig,
		},
		broadcast: ws.broadcast,
	};
}
