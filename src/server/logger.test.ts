import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getServerLogs, getServerLogsByLevel, insertServerLog, pruneServerLogs } from "./db/index.ts";
import { log, setLogBroadcast } from "./logger.ts";

describe("server logging", () => {
	beforeEach(() => {
		pruneServerLogs(0);
	});

	afterEach(() => {
		pruneServerLogs(0);
	});

	test("insertServerLog creates a log entry that can be retrieved", () => {
		const entry = insertServerLog("info", "server", "Test message", null);

		expect(entry.id).toBeTruthy();
		expect(entry.level).toBe("info");
		expect(entry.source).toBe("server");
		expect(entry.message).toBe("Test message");
		expect(entry.meta).toBeNull();
		expect(entry.createdAt).toBeTruthy();

		const logs = getServerLogs(10);
		expect(logs).toHaveLength(1);
		expect(logs.at(0)?.id).toBe(entry.id);
	});

	test("insertServerLog stores meta when provided", () => {
		const meta = JSON.stringify({ taskId: "abc123" });
		insertServerLog("error", "orchestrator", "Task failed", meta);

		const logs = getServerLogs(10);
		expect(logs.at(0)?.meta).toBe(meta);
	});

	test("getServerLogs returns entries in descending order with limit", () => {
		insertServerLog("info", "server", "First", null);
		insertServerLog("info", "server", "Second", null);
		insertServerLog("info", "server", "Third", null);

		const all = getServerLogs(10);
		expect(all).toHaveLength(3);
		expect(all.at(0)?.message).toBe("Third");
		expect(all.at(2)?.message).toBe("First");

		const limited = getServerLogs(2);
		expect(limited).toHaveLength(2);
		expect(limited.at(0)?.message).toBe("Third");
	});

	test("getServerLogsByLevel filters by level", () => {
		insertServerLog("info", "server", "Info message", null);
		insertServerLog("warn", "ws", "Warning message", null);
		insertServerLog("error", "orchestrator", "Error message", null);
		insertServerLog("info", "server", "Another info", null);

		const infos = getServerLogsByLevel("info", 10);
		expect(infos).toHaveLength(2);
		for (const entry of infos) {
			expect(entry.level).toBe("info");
		}

		const errors = getServerLogsByLevel("error", 10);
		expect(errors).toHaveLength(1);
		expect(errors.at(0)?.message).toBe("Error message");
	});

	test("pruneServerLogs keeps only the specified number of most recent entries", () => {
		for (let i = 0; i < 20; i++) {
			insertServerLog("info", "server", `Message ${i}`, null);
		}

		expect(getServerLogs(100)).toHaveLength(20);

		pruneServerLogs(5);

		const remaining = getServerLogs(100);
		expect(remaining).toHaveLength(5);
		expect(remaining.at(0)?.message).toBe("Message 19");
		expect(remaining.at(4)?.message).toBe("Message 15");
	});

	test("broadcast errors do not cause infinite recursion", () => {
		let broadcastCount = 0;
		setLogBroadcast(() => {
			broadcastCount++;
			// Simulate an error during broadcast that triggers another log call
			if (broadcastCount === 1) {
				log.error("ws", "broadcast failed");
			}
		});

		log.info("server", "trigger broadcast");

		// The first log triggers broadcast (count=1), which logs an error.
		// That error log should NOT trigger another broadcast (re-entrance guard).
		expect(broadcastCount).toBe(1);

		// Clean up
		setLogBroadcast(() => {});
	});

	test("pruneServerLogs with 0 removes all entries", () => {
		insertServerLog("info", "server", "Will be pruned", null);
		insertServerLog("warn", "ws", "Also pruned", null);

		pruneServerLogs(0);

		expect(getServerLogs(100)).toHaveLength(0);
	});
});
