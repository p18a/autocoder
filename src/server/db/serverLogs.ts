import { ulid } from "ulid";
import type { LogLevel, LogSource, ServerLog } from "../../shared/types.ts";
import { db } from "./connection.ts";

class ServerLogRow implements ServerLog {
	id!: string;
	level!: LogLevel;
	source!: LogSource;
	message!: string;
	meta!: string | null;
	createdAt!: string;
}

class CountRow {
	count!: number;
}

const SERVER_LOG_COLS = "id, level, source, message, meta, created_at AS createdAt";

const insertServerLogStmt = db.prepare(
	"INSERT INTO server_logs (id, level, source, message, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const pruneServerLogsStmt = db.prepare(
	"DELETE FROM server_logs WHERE id NOT IN (SELECT id FROM server_logs ORDER BY created_at DESC LIMIT ?)",
);
const selectServerLogs = db
	.prepare(`SELECT ${SERVER_LOG_COLS} FROM server_logs ORDER BY created_at DESC LIMIT ?`)
	.as(ServerLogRow);
const selectServerLogsByLevel = db
	.prepare(`SELECT ${SERVER_LOG_COLS} FROM server_logs WHERE level = ? ORDER BY created_at DESC LIMIT ?`)
	.as(ServerLogRow);
const countServerLogs = db.prepare("SELECT COUNT(*) AS count FROM server_logs").as(CountRow);

export function insertServerLog(level: LogLevel, source: LogSource, message: string, meta: string | null): ServerLog {
	const id = ulid();
	const now = new Date().toISOString();
	insertServerLogStmt.run(id, level, source, message, meta, now);
	return { id, level, source, message, meta, createdAt: now };
}

export function pruneServerLogs(keepCount: number): void {
	pruneServerLogsStmt.run(keepCount);
}

export function getServerLogs(limit = 100): ServerLog[] {
	return selectServerLogs.all(limit);
}

export function getServerLogsByLevel(level: LogLevel, limit = 100): ServerLog[] {
	return selectServerLogsByLevel.all(level, limit);
}

export function getServerLogCount(): number {
	const row = countServerLogs.get();
	return row?.count ?? 0;
}
