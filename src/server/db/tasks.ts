import { ulid } from "ulid";
import { assertTransition, isTerminalStatus } from "../../shared/fsm.ts";
import type { Task, TaskStatus, TaskType } from "../../shared/types.ts";
import { db } from "./connection.ts";

class TaskRow implements Task {
	id!: string;
	projectId!: string;
	title!: string | null;
	prompt!: string;
	status!: TaskStatus;
	taskType!: TaskType;
	originTaskId!: string | null;
	createdAt!: string;
	updatedAt!: string;
}

const TASK_COLS =
	"id, project_id AS projectId, title, prompt, status, task_type AS taskType, origin_task_id AS originTaskId, created_at AS createdAt, updated_at AS updatedAt";

const insertTask = db.prepare(
	"INSERT INTO tasks (id, project_id, title, prompt, status, task_type, origin_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const selectTask = db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).as(TaskRow);
const selectTasksByProject = db
	.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE project_id = ? ORDER BY created_at ASC`)
	.as(TaskRow);
const selectAllTasks = db.prepare(`SELECT ${TASK_COLS} FROM tasks ORDER BY created_at ASC`).as(TaskRow);
const updateTaskStmt = db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?");
const updateTaskCAS = db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?");
const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?");
const selectQueuedTasks = db
	.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE status = 'queued' ORDER BY created_at ASC`)
	.as(TaskRow);
const selectQueuedTasksByProject = db
	.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE project_id = ? AND status = 'queued' ORDER BY created_at ASC`)
	.as(TaskRow);
const selectRunningTasksByProject = db
	.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE project_id = ? AND status = 'running' ORDER BY created_at ASC`)
	.as(TaskRow);
const deleteTaskLogsByTask = db.prepare("DELETE FROM task_logs WHERE task_id = ?");

export function createTask(
	projectId: string,
	prompt: string,
	taskType: TaskType = "execution",
	originTaskId: string | null = null,
	title: string | null = null,
): Task {
	const id = ulid();
	const now = new Date().toISOString();
	insertTask.run(id, projectId, title, prompt, "queued", taskType, originTaskId, now, now);
	return { id, projectId, title, prompt, status: "queued", taskType, originTaskId, createdAt: now, updatedAt: now };
}

export function getTask(id: string): Task | null {
	return selectTask.get(id) ?? null;
}

export function listTasks(projectId?: string): Task[] {
	if (projectId) {
		return selectTasksByProject.all(projectId);
	}
	return selectAllTasks.all();
}

export function getQueuedTasks(): Task[] {
	return selectQueuedTasks.all();
}

export function updateTask(id: string, status: TaskStatus, expectedStatus?: TaskStatus): Task | null {
	const currentTask = getTask(id);
	if (!currentTask) return null;

	if (expectedStatus && currentTask.status !== expectedStatus) {
		return null;
	}

	assertTransition(currentTask.status, status);

	const now = new Date().toISOString();
	if (expectedStatus) {
		const result = updateTaskCAS.run(status, now, id, expectedStatus);
		if (result.changes === 0) return null;
	} else {
		updateTaskStmt.run(status, now, id);
	}
	return getTask(id);
}

export function removeTask(id: string): boolean {
	const task = getTask(id);
	if (!task) return false;

	if (!isTerminalStatus(task.status)) {
		throw new Error(`Cannot remove task ${id} in non-terminal status "${task.status}". Cancel it first.`);
	}

	deleteTaskLogsByTask.run(id);
	const result = deleteTaskStmt.run(id);
	return result.changes > 0;
}

export function getQueuedTasksByProject(projectId: string): Task[] {
	return selectQueuedTasksByProject.all(projectId);
}

export function getRunningTasksByProject(projectId: string): Task[] {
	return selectRunningTasksByProject.all(projectId);
}
