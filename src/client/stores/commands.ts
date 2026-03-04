import { useConnectionStore } from "./connection.ts";

function send(data: string): boolean {
	return useConnectionStore.getState().send(data);
}

// Task commands
export function sendAddTask(projectId: string, prompt: string): void {
	send(JSON.stringify({ type: "add_task", projectId, prompt }));
}

export function sendCancelTask(taskId: string): void {
	send(JSON.stringify({ type: "cancel_task", taskId }));
}

export function sendDeleteTask(taskId: string): void {
	send(JSON.stringify({ type: "remove_task", taskId }));
}

export function sendRetryTask(taskId: string): void {
	send(JSON.stringify({ type: "retry_task", taskId }));
}

export function sendRequestTaskLogs(taskId: string, before?: string): void {
	const msg = before
		? JSON.stringify({ type: "get_task_logs", taskId, before })
		: JSON.stringify({ type: "get_task_logs", taskId });
	send(msg);
}

// Project commands
export function sendStartProject(projectId: string, mode: "discover" | "execute"): void {
	send(JSON.stringify({ type: "start_project", projectId, mode }));
}

export function sendStopProject(projectId: string): void {
	send(JSON.stringify({ type: "stop_project", projectId }));
}

export function sendCreateProject(name: string, path: string): boolean {
	return send(JSON.stringify({ type: "create_project", name, path }));
}

export function sendDeleteProject(projectId: string): void {
	send(JSON.stringify({ type: "delete_project", projectId }));
}

// Config commands
export function sendUpdateConfig(key: string, value: string): void {
	send(JSON.stringify({ type: "set_config", key, value }));
}

// Server log commands
export function sendRequestServerLogs(limit = 200, level?: string): void {
	const msg: Record<string, unknown> = { type: "get_server_logs", limit };
	if (level) {
		msg.level = level;
	}
	send(JSON.stringify(msg));
}
