import { ulid } from "ulid";
import type { TaskLog } from "../../shared/types.ts";
import { MAX_LOG_CONTENT_LENGTH } from "../constants.ts";
import { db } from "./connection.ts";

class TaskLogRow implements TaskLog {
	id!: string;
	taskId!: string;
	content!: string;
	stream!: "stdout" | "stderr" | "system";
	createdAt!: string;
}

class CountRow {
	count!: number;
}

const TASK_LOG_COLS = "id, task_id AS taskId, content, stream, created_at AS createdAt";

const insertTaskLog = db.prepare(
	"INSERT INTO task_logs (id, task_id, content, stream, created_at) VALUES (?, ?, ?, ?, ?)",
);
const selectTaskLogsLatest = db
	.prepare(`SELECT ${TASK_LOG_COLS} FROM task_logs WHERE task_id = ? ORDER BY rowid DESC LIMIT ?`)
	.as(TaskLogRow);
const selectTaskLogsBefore = db
	.prepare(
		`SELECT ${TASK_LOG_COLS} FROM task_logs WHERE task_id = ? AND rowid < (SELECT rowid FROM task_logs WHERE id = ?) ORDER BY rowid DESC LIMIT ?`,
	)
	.as(TaskLogRow);
const countTaskLogs = db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_id = ?").as(CountRow);

export function appendTaskLog(
	taskId: string,
	content: string,
	stream: "stdout" | "stderr" | "system" = "stdout",
): TaskLog {
	const id = ulid();
	const now = new Date().toISOString();
	const truncated =
		content.length > MAX_LOG_CONTENT_LENGTH ? `${content.slice(0, MAX_LOG_CONTENT_LENGTH)}… [truncated]` : content;
	insertTaskLog.run(id, taskId, truncated, stream, now);
	return { id, taskId, content: truncated, stream, createdAt: now };
}

export function getTaskLogs(taskId: string, limit = 500, before?: string): TaskLog[] {
	const rows = before ? selectTaskLogsBefore.all(taskId, before, limit) : selectTaskLogsLatest.all(taskId, limit);
	rows.reverse();
	return rows;
}

export function getTaskLogCount(taskId: string): number {
	const row = countTaskLogs.get(taskId);
	return row?.count ?? 0;
}
