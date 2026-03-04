import type { LogLevel, LogSource, ServerLog } from "../shared/types.ts";
import { insertServerLog, pruneServerLogs } from "./db/index.ts";

const MAX_SERVER_LOGS = 10_000;
const PRUNE_INTERVAL = 500;

let insertCount = 0;

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: "\x1b[90m",
	info: "\x1b[36m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
};
const RESET = "\x1b[0m";

/** Optional broadcast callback — set by ws.ts to push server logs to connected clients. */
let broadcastFn: ((log: ServerLog) => void) | null = null;

/** Re-entrance guard: prevents log → broadcast → error → log infinite recursion. */
let isBroadcasting = false;

/** Register the broadcast callback so server logs are pushed to WS clients in real time. */
export function setLogBroadcast(fn: (log: ServerLog) => void) {
	broadcastFn = fn;
}

function writeLog(level: LogLevel, source: LogSource, message: string, meta?: string): ServerLog {
	const metaStr = meta ?? null;

	// Console output
	const color = LEVEL_COLORS[level];
	const metaSuffix = metaStr ? ` ${metaStr}` : "";
	const line = `${color}[${level.toUpperCase()}]${RESET} [${source}] ${message}${metaSuffix}`;

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}

	// DB insert
	const entry = insertServerLog(level, source, message, metaStr);

	// Broadcast to connected clients (skip if already inside a broadcast to prevent recursion)
	if (broadcastFn && !isBroadcasting) {
		isBroadcasting = true;
		try {
			broadcastFn(entry);
		} finally {
			isBroadcasting = false;
		}
	}

	// Periodic pruning
	insertCount++;
	if (insertCount >= PRUNE_INTERVAL) {
		insertCount = 0;
		pruneServerLogs(MAX_SERVER_LOGS);
	}

	return entry;
}

function info(source: LogSource, message: string, meta?: string): ServerLog {
	return writeLog("info", source, message, meta);
}

function warn(source: LogSource, message: string, meta?: string): ServerLog {
	return writeLog("warn", source, message, meta);
}

function error(source: LogSource, message: string, meta?: string): ServerLog {
	return writeLog("error", source, message, meta);
}

function debug(source: LogSource, message: string, meta?: string): ServerLog {
	return writeLog("debug", source, message, meta);
}

export const log = Object.assign(writeLog, { info, warn, error, debug });
