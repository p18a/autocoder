import type { ServerWebSocket } from "bun";
import { clientMessageSchema } from "../shared/schema.ts";
import type { ClientMessage, ServerMessage } from "../shared/types.ts";
import { WS_MAX_MESSAGE_SIZE, WS_RATE_LIMIT_MAX, WS_RATE_LIMIT_WINDOW_MS } from "./constants.ts";
import * as db from "./db/index.ts";
import { handleSetConfig } from "./handlers/config.ts";
import { handleGetServerLogs, handleGetTaskLogs } from "./handlers/logs.ts";
import { handleCreateProject, handleDeleteProject, handleStartProject, handleStopProject } from "./handlers/project.ts";
import { handleAddTask, handleCancelTask, handleRemoveTask, handleRetryTask } from "./handlers/task.ts";
import type { HandlerMap } from "./handlers/types.ts";
import { log, setLogBroadcast } from "./logger.ts";

export type WSData = { id: string };

const clients = new Set<ServerWebSocket<WSData>>();

// ── Per-client rate limiter ─────────────────────────────────────────

/** Sliding-window timestamps for each connected client. */
const rateLimitMap = new Map<string, number[]>();

/**
 * Returns `true` if the client is within the rate limit, `false` if the
 * message should be rejected.  Mutates the internal timestamp array.
 */
export function checkRateLimit(clientId: string): boolean {
	const now = Date.now();
	const cutoff = now - WS_RATE_LIMIT_WINDOW_MS;

	let timestamps = rateLimitMap.get(clientId);
	if (!timestamps) {
		timestamps = [];
		rateLimitMap.set(clientId, timestamps);
	}

	// Drop entries outside the window
	const firstValid = timestamps.findIndex((t) => t > cutoff);
	if (firstValid > 0) {
		timestamps.splice(0, firstValid);
	} else if (firstValid === -1) {
		timestamps.length = 0;
	}

	if (timestamps.length >= WS_RATE_LIMIT_MAX) {
		return false;
	}

	timestamps.push(now);
	return true;
}

function clearRateLimit(clientId: string) {
	rateLimitMap.delete(clientId);
}

export function broadcast(message: ServerMessage) {
	const data = JSON.stringify(message);
	for (const ws of clients) {
		try {
			ws.send(data);
		} catch {
			clients.delete(ws);
		}
	}
}

// Wire up real-time server log broadcasting to WS clients
setLogBroadcast((entry) => {
	broadcast({ type: "server_log", log: entry });
});

function sendTo(ws: ServerWebSocket<WSData>, message: ServerMessage) {
	ws.send(JSON.stringify(message));
}

const handlers: HandlerMap = {
	create_project: handleCreateProject,
	delete_project: handleDeleteProject,
	start_project: handleStartProject,
	stop_project: handleStopProject,
	add_task: handleAddTask,
	cancel_task: handleCancelTask,
	remove_task: handleRemoveTask,
	retry_task: handleRetryTask,
	get_task_logs: handleGetTaskLogs,
	set_config: handleSetConfig,
	get_server_logs: handleGetServerLogs,
};

async function handleMessage(ws: ServerWebSocket<WSData>, raw: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		log.warn("ws", "Received invalid JSON from client");
		sendTo(ws, { type: "error", message: "Invalid JSON" });
		return;
	}

	const result = clientMessageSchema.safeParse(parsed);
	if (!result.success) {
		log.warn("ws", "Invalid message format from client");
		sendTo(ws, { type: "error", message: "Invalid message format" });
		return;
	}

	const msg = result.data as ClientMessage;
	const commandId = msg.commandId;

	try {
		log.info("ws", `Dispatch: ${msg.type}`, JSON.stringify(msg));
		await dispatch(ws, msg);
		if (commandId) {
			sendTo(ws, { type: "ack", commandId });
		}
	} catch (err) {
		log.error("ws", `Handler error for "${msg.type}": ${err instanceof Error ? err.message : String(err)}`);
		sendTo(ws, {
			type: "error",
			message: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
			commandId,
		});
	}
}

export async function dispatch(ws: ServerWebSocket<WSData>, msg: ClientMessage) {
	const ctx = { ws, broadcast, sendTo };
	switch (msg.type) {
		case "create_project":
			return handlers.create_project(ctx, msg);
		case "delete_project":
			return handlers.delete_project(ctx, msg);
		case "start_project":
			return handlers.start_project(ctx, msg);
		case "stop_project":
			return handlers.stop_project(ctx, msg);
		case "add_task":
			return handlers.add_task(ctx, msg);
		case "cancel_task":
			return handlers.cancel_task(ctx, msg);
		case "remove_task":
			return handlers.remove_task(ctx, msg);
		case "retry_task":
			return handlers.retry_task(ctx, msg);
		case "get_task_logs":
			return handlers.get_task_logs(ctx, msg);
		case "set_config":
			return handlers.set_config(ctx, msg);
		case "get_server_logs":
			return handlers.get_server_logs(ctx, msg);
		default: {
			const _exhaustive: never = msg;
			throw new Error(`Unknown message type: ${JSON.stringify(_exhaustive)}`);
		}
	}
}

export const websocket = {
	open(ws: ServerWebSocket<WSData>) {
		clients.add(ws);
		log.info("ws", `Client connected: ${ws.data.id}`);
		const projects = db.listProjects();
		const tasks = db.listTasks();
		const config = db.listConfig();
		sendTo(ws, { type: "init", projects, tasks, config });
	},
	message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
		const raw = typeof message === "string" ? message : message.toString();

		// Size guard — reject before JSON parse
		if (raw.length > WS_MAX_MESSAGE_SIZE) {
			log.warn("ws", `Message from ${ws.data.id} exceeds size limit (${raw.length} bytes)`);
			sendTo(ws, { type: "error", message: "Message too large" });
			return;
		}

		// Rate limit — sliding window per client
		if (!checkRateLimit(ws.data.id)) {
			log.warn("ws", `Rate limit exceeded for ${ws.data.id}`);
			sendTo(ws, { type: "error", message: "Rate limit exceeded" });
			return;
		}

		handleMessage(ws, raw);
	},
	close(ws: ServerWebSocket<WSData>) {
		clients.delete(ws);
		clearRateLimit(ws.data.id);
		log.info("ws", `Client disconnected: ${ws.data.id}`);
	},
};
