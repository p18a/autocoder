import { isTerminalStatus } from "../../shared/fsm.ts";
import * as db from "../db/index.ts";
import { cancelTask, isProjectStarted, processQueue } from "../orchestrator/index.ts";
import type { Handler } from "./types.ts";

export const handleAddTask: Handler<"add_task"> = async (ctx, msg) => {
	if (!db.getProject(msg.projectId)) {
		ctx.sendTo(ctx.ws, { type: "error", message: `Project ${msg.projectId} not found` });
		return;
	}
	const task = db.createTask(msg.projectId, msg.prompt);
	ctx.broadcast({ type: "task_added", task });
	if (await isProjectStarted(msg.projectId)) {
		await processQueue();
	}
};

export const handleRetryTask: Handler<"retry_task"> = async (ctx, msg) => {
	const original = db.getTask(msg.taskId);
	if (!original) {
		ctx.sendTo(ctx.ws, { type: "error", message: `Task ${msg.taskId} not found` });
		return;
	}
	if (!isTerminalStatus(original.status) || original.status === "completed") {
		ctx.sendTo(ctx.ws, {
			type: "error",
			message: `Cannot retry task in "${original.status}" status`,
		});
		return;
	}
	const task = db.createTask(original.projectId, original.prompt, original.taskType, original.id, original.title);
	db.removeTask(original.id);
	ctx.broadcast({ type: "task_removed", taskId: original.id });
	ctx.broadcast({ type: "task_added", task });
	if (await isProjectStarted(original.projectId)) {
		await processQueue();
	}
};

export const handleCancelTask: Handler<"cancel_task"> = async (_ctx, msg) => {
	await cancelTask(msg.taskId);
};

export const handleRemoveTask: Handler<"remove_task"> = (ctx, msg) => {
	try {
		if (db.removeTask(msg.taskId)) {
			ctx.broadcast({ type: "task_removed", taskId: msg.taskId });
		}
	} catch (err) {
		ctx.sendTo(ctx.ws, {
			type: "error",
			message: err instanceof Error ? err.message : "Failed to remove task",
		});
	}
};
