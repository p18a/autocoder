import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../shared/types.ts";
import { WS_MAX_MESSAGE_SIZE, WS_RATE_LIMIT_MAX } from "./constants.ts";
import * as db from "./db/index.ts";
import { checkRateLimit, dispatch, type WSData, websocket } from "./ws.ts";

describe("WebSocket Dispatch", () => {
	let sentMessages: ServerMessage[] = [];
	let mockWs: ServerWebSocket<WSData>;
	let tempDir: string;

	beforeEach(async () => {
		sentMessages = [];
		tempDir = await mkdtemp(join(homedir(), ".autocoder-test-"));
		mockWs = {
			data: { id: "test-client" },
			send: (data: string | Buffer) => {
				sentMessages.push(JSON.parse(data.toString()) as ServerMessage);
			},
		} as unknown as ServerWebSocket<WSData>;

		// Clear initial messages sent on open
		websocket.open(mockWs);
		sentMessages = [];
	});

	afterEach(async () => {
		websocket.close(mockWs);
		// Cleanup any test projects
		for (const p of db.listProjects()) {
			if (p.name.includes("Test")) {
				db.deleteProjectCascade(p.id);
			}
		}
		await rm(tempDir, { recursive: true, force: true });
	});

	test("create_project broadcasts project_created with resolved path", async () => {
		await dispatch(mockWs, { type: "create_project", name: "WS Test", path: tempDir });

		const msg = sentMessages.find((m) => m.type === "project_created");
		expect(msg).toBeDefined();
		if (msg?.type === "project_created") {
			expect(msg.project.name).toBe("WS Test");
			expect(msg.project.path).toBe(tempDir);
		}
	});

	test("create_project rejects non-existent path", async () => {
		await expect(
			dispatch(mockWs, { type: "create_project", name: "Bad Test", path: join(homedir(), "nonexistent-path-xyz-123") }),
		).rejects.toThrow("Path does not exist");
	});

	test("create_project rejects a file path (not a directory)", async () => {
		const filePath = join(tempDir, "not-a-dir.txt");
		await writeFile(filePath, "hello");

		await expect(dispatch(mockWs, { type: "create_project", name: "File Test", path: filePath })).rejects.toThrow(
			"Path is not a directory",
		);
	});

	test("add_task with bad projectId sends error", async () => {
		await dispatch(mockWs, { type: "add_task", projectId: "invalid-id", prompt: "Test prompt" });

		const msg = sentMessages.find((m) => m.type === "error");
		expect(msg).toBeDefined();
		if (msg?.type === "error") {
			expect(msg.message).toContain("not found");
		}
	});

	test("remove_task on running task sends error", async () => {
		const project = db.createProject("WS Remove Test", tempDir);
		const task = db.createTask(project.id, "Running task");
		db.updateTask(task.id, "running");

		await dispatch(mockWs, { type: "remove_task", taskId: task.id });

		const msg = sentMessages.find((m) => m.type === "error");
		expect(msg).toBeDefined();
		if (msg?.type === "error") {
			expect(msg.message).toContain("Cannot remove");
		}
	});

	test("cancel_task on queued task broadcasts task_updated with cancelled status", async () => {
		const project = db.createProject("WS Cancel Test", tempDir);
		const task = db.createTask(project.id, "Cancel task");

		await dispatch(mockWs, { type: "cancel_task", taskId: task.id });

		const msg = sentMessages.find((m) => m.type === "task_updated" && m.task.status === "cancelled");
		expect(msg).toBeDefined();
		if (msg?.type === "task_updated") {
			expect(msg.task.id).toBe(task.id);
			expect(msg.task.status).toBe("cancelled");
		}
	});

	test("retry_task creates new queued task from failed task", async () => {
		const project = db.createProject("WS Retry Test", tempDir);
		const task = db.createTask(project.id, "Retry me", "execution", null, "Fix bug");
		db.updateTask(task.id, "running");
		db.updateTask(task.id, "failed");

		await dispatch(mockWs, { type: "retry_task", taskId: task.id });

		const removedMsg = sentMessages.find((m) => m.type === "task_removed");
		expect(removedMsg).toBeDefined();
		if (removedMsg?.type === "task_removed") {
			expect(removedMsg.taskId).toBe(task.id);
		}

		const msg = sentMessages.find((m) => m.type === "task_added");
		expect(msg).toBeDefined();
		if (msg?.type === "task_added") {
			expect(msg.task.id).not.toBe(task.id);
			expect(msg.task.prompt).toBe("Retry me");
			expect(msg.task.title).toBe("Fix bug");
			expect(msg.task.taskType).toBe("execution");
			expect(msg.task.originTaskId).toBe(task.id);
			expect(msg.task.status).toBe("queued");
		}

		expect(db.getTask(task.id)).toBeNull();
	});

	test("retry_task creates new queued task from cancelled task", async () => {
		const project = db.createProject("WS Retry Cancel Test", tempDir);
		const task = db.createTask(project.id, "Cancel me");
		db.updateTask(task.id, "cancelled");

		await dispatch(mockWs, { type: "retry_task", taskId: task.id });

		const removedMsg = sentMessages.find((m) => m.type === "task_removed");
		expect(removedMsg).toBeDefined();
		if (removedMsg?.type === "task_removed") {
			expect(removedMsg.taskId).toBe(task.id);
		}

		const msg = sentMessages.find((m) => m.type === "task_added");
		expect(msg).toBeDefined();
		if (msg?.type === "task_added") {
			expect(msg.task.originTaskId).toBe(task.id);
			expect(msg.task.status).toBe("queued");
		}

		expect(db.getTask(task.id)).toBeNull();
	});

	test("retry_task rejects completed task", async () => {
		const project = db.createProject("WS Retry Completed Test", tempDir);
		const task = db.createTask(project.id, "Completed task");
		db.updateTask(task.id, "running");
		db.updateTask(task.id, "completed");

		await dispatch(mockWs, { type: "retry_task", taskId: task.id });

		const errorMsg = sentMessages.find((m) => m.type === "error");
		expect(errorMsg).toBeDefined();
		if (errorMsg?.type === "error") {
			expect(errorMsg.message).toContain("Cannot retry");
		}
	});

	test("retry_task with invalid taskId sends error", async () => {
		await dispatch(mockWs, { type: "retry_task", taskId: "nonexistent" });

		const msg = sentMessages.find((m) => m.type === "error");
		expect(msg).toBeDefined();
		if (msg?.type === "error") {
			expect(msg.message).toContain("not found");
		}
	});

	test("rejects messages exceeding size limit", () => {
		const oversized = "x".repeat(WS_MAX_MESSAGE_SIZE + 1);
		websocket.message(mockWs, oversized);

		const msg = sentMessages.find((m) => m.type === "error");
		expect(msg).toBeDefined();
		if (msg?.type === "error") {
			expect(msg.message).toBe("Message too large");
		}
	});

	test("rejects messages when rate limit is exceeded", () => {
		const validMsg = JSON.stringify({ type: "get_server_logs" });

		// Exhaust the rate limit
		for (let i = 0; i < WS_RATE_LIMIT_MAX; i++) {
			websocket.message(mockWs, validMsg);
		}

		sentMessages = [];

		// Next message should be rejected
		websocket.message(mockWs, validMsg);

		const msg = sentMessages.find((m) => m.type === "error");
		expect(msg).toBeDefined();
		if (msg?.type === "error") {
			expect(msg.message).toBe("Rate limit exceeded");
		}
	});

	test("get_task_logs returns paginated logs with default limit", async () => {
		const project = db.createProject("WS Log Test", tempDir);
		const task = db.createTask(project.id, "Log task");

		// Create 5 logs
		for (let i = 0; i < 5; i++) {
			db.appendTaskLog(task.id, `Log ${i}`, "stdout");
		}

		await dispatch(mockWs, { type: "get_task_logs", taskId: task.id });

		const msg = sentMessages.find((m) => m.type === "task_logs");
		expect(msg).toBeDefined();
		if (msg?.type === "task_logs") {
			expect(msg.logs).toHaveLength(5);
			expect(msg.total).toBe(5);
			expect(msg.hasMore).toBe(false);
		}
	});

	test("get_task_logs respects limit and reports hasMore", async () => {
		const project = db.createProject("WS Limit Test", tempDir);
		const task = db.createTask(project.id, "Limit task");

		// Create 10 logs
		const allLogs = [];
		for (let i = 0; i < 10; i++) {
			allLogs.push(db.appendTaskLog(task.id, `Log ${i}`, "stdout"));
		}

		await dispatch(mockWs, { type: "get_task_logs", taskId: task.id, limit: 3 });

		const msg = sentMessages.find((m) => m.type === "task_logs");
		expect(msg).toBeDefined();
		if (msg?.type === "task_logs") {
			// Should return the latest 3 logs (by insertion order)
			expect(msg.logs).toHaveLength(3);
			expect(msg.logs.map((l) => l.content)).toEqual(["Log 7", "Log 8", "Log 9"]);
			expect(msg.total).toBe(10);
			expect(msg.hasMore).toBe(true);
		}
	});

	test("get_task_logs supports cursor-based pagination with before", async () => {
		const project = db.createProject("WS Cursor Test", tempDir);
		const task = db.createTask(project.id, "Cursor task");

		// Create 10 logs
		for (let i = 0; i < 10; i++) {
			db.appendTaskLog(task.id, `Log ${i}`, "stdout");
		}

		// First request: get latest 3
		await dispatch(mockWs, { type: "get_task_logs", taskId: task.id, limit: 3 });
		const firstMsg = sentMessages.find((m) => m.type === "task_logs");
		expect(firstMsg?.type).toBe("task_logs");
		if (firstMsg?.type !== "task_logs") return;

		expect(firstMsg.logs).toHaveLength(3);
		const firstLog = firstMsg.logs[0];
		expect(firstLog).toBeDefined();
		if (!firstLog) return;
		const beforeCursor = firstLog.id;
		sentMessages = [];

		// Second request: get 3 before the cursor
		await dispatch(mockWs, { type: "get_task_logs", taskId: task.id, limit: 3, before: beforeCursor });
		const secondMsg = sentMessages.find((m) => m.type === "task_logs");
		expect(secondMsg).toBeDefined();
		if (secondMsg?.type === "task_logs") {
			expect(secondMsg.logs).toHaveLength(3);
			expect(secondMsg.logs.map((l) => l.content)).toEqual(["Log 4", "Log 5", "Log 6"]);
			expect(secondMsg.hasMore).toBe(true);
		}
	});
});

describe("checkRateLimit", () => {
	test("allows messages up to the limit", () => {
		const id = `rate-test-${Date.now()}`;
		for (let i = 0; i < WS_RATE_LIMIT_MAX; i++) {
			expect(checkRateLimit(id)).toBe(true);
		}
	});

	test("rejects messages beyond the limit", () => {
		const id = `rate-test-reject-${Date.now()}`;
		for (let i = 0; i < WS_RATE_LIMIT_MAX; i++) {
			checkRateLimit(id);
		}
		expect(checkRateLimit(id)).toBe(false);
	});
});
