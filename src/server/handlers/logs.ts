import * as db from "../db/index.ts";
import { getJournalEntries, getJournalEntriesByTier } from "../db/journal.ts";
import type { Handler } from "./types.ts";

export const handleGetTaskLogs: Handler<"get_task_logs"> = (ctx, msg) => {
	const limit = msg.limit ?? 500;
	const logs = db.getTaskLogs(msg.taskId, limit, msg.before);
	const total = db.getTaskLogCount(msg.taskId);
	const firstId = logs[0]?.id;
	const hasMore = firstId !== undefined && db.getTaskLogs(msg.taskId, 1, firstId).length > 0;
	ctx.sendTo(ctx.ws, { type: "task_logs", taskId: msg.taskId, logs, total, hasMore });
};

export const handleGetServerLogs: Handler<"get_server_logs"> = (ctx, msg) => {
	const logs = msg.level ? db.getServerLogsByLevel(msg.level, msg.limit ?? 100) : db.getServerLogs(msg.limit ?? 100);
	ctx.sendTo(ctx.ws, { type: "server_logs", logs });
};

export const handleGetJournal: Handler<"get_journal"> = (ctx, msg) => {
	const limit = msg.limit ?? 30;
	const entries = msg.tier
		? getJournalEntriesByTier(msg.projectId, msg.tier, limit)
		: getJournalEntries(msg.projectId, limit);
	ctx.sendTo(ctx.ws, { type: "journal_entries", projectId: msg.projectId, entries });
};
