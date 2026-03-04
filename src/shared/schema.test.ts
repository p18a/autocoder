import { describe, expect, test } from "bun:test";
import { absolutePathSchema, clientMessageSchema } from "./schema.ts";

describe("absolutePathSchema", () => {
	test("accepts absolute paths", () => {
		expect(absolutePathSchema.safeParse("/home/user/project").success).toBe(true);
		expect(absolutePathSchema.safeParse("/tmp").success).toBe(true);
		expect(absolutePathSchema.safeParse("/").success).toBe(true);
	});

	test("rejects relative paths", () => {
		expect(absolutePathSchema.safeParse("relative/path").success).toBe(false);
		expect(absolutePathSchema.safeParse("./relative").success).toBe(false);
	});

	test("rejects paths with .. traversal", () => {
		expect(absolutePathSchema.safeParse("/home/user/../etc").success).toBe(false);
		expect(absolutePathSchema.safeParse("/home/..").success).toBe(false);
		expect(absolutePathSchema.safeParse("/../etc/passwd").success).toBe(false);
	});

	test("allows paths containing .. as part of a name (not traversal)", () => {
		expect(absolutePathSchema.safeParse("/home/user/my..project").success).toBe(true);
	});

	test("rejects empty string", () => {
		expect(absolutePathSchema.safeParse("").success).toBe(false);
	});
});

describe("clientMessageSchema create_project", () => {
	test("rejects create_project with relative path", () => {
		const result = clientMessageSchema.safeParse({
			type: "create_project",
			name: "Test",
			path: "relative/path",
		});
		expect(result.success).toBe(false);
	});

	test("rejects create_project with traversal path", () => {
		const result = clientMessageSchema.safeParse({
			type: "create_project",
			name: "Test",
			path: "/home/user/../etc",
		});
		expect(result.success).toBe(false);
	});

	test("accepts create_project with valid absolute path", () => {
		const result = clientMessageSchema.safeParse({
			type: "create_project",
			name: "Test",
			path: "/home/user/project",
		});
		expect(result.success).toBe(true);
	});
});

describe("clientMessageSchema retry_task", () => {
	test("accepts retry_task with taskId", () => {
		const result = clientMessageSchema.safeParse({
			type: "retry_task",
			taskId: "task-123",
		});
		expect(result.success).toBe(true);
	});

	test("accepts retry_task with commandId", () => {
		const result = clientMessageSchema.safeParse({
			type: "retry_task",
			taskId: "task-123",
			commandId: "cmd-1",
		});
		expect(result.success).toBe(true);
	});

	test("rejects retry_task without taskId", () => {
		const result = clientMessageSchema.safeParse({
			type: "retry_task",
		});
		expect(result.success).toBe(false);
	});
});

describe("clientMessageSchema get_task_logs", () => {
	test("accepts basic get_task_logs", () => {
		const result = clientMessageSchema.safeParse({
			type: "get_task_logs",
			taskId: "task-123",
		});
		expect(result.success).toBe(true);
	});

	test("accepts get_task_logs with limit and before", () => {
		const result = clientMessageSchema.safeParse({
			type: "get_task_logs",
			taskId: "task-123",
			limit: 100,
			before: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		});
		expect(result.success).toBe(true);
	});

	test("rejects get_task_logs with limit exceeding max", () => {
		const result = clientMessageSchema.safeParse({
			type: "get_task_logs",
			taskId: "task-123",
			limit: 5000,
		});
		expect(result.success).toBe(false);
	});

	test("rejects get_task_logs with limit of 0", () => {
		const result = clientMessageSchema.safeParse({
			type: "get_task_logs",
			taskId: "task-123",
			limit: 0,
		});
		expect(result.success).toBe(false);
	});
});

describe("clientMessageSchema set_config", () => {
	test("accepts auto_continue config key", () => {
		const result = clientMessageSchema.safeParse({
			type: "set_config",
			key: "auto_continue:project-123",
			value: "true",
		});
		expect(result.success).toBe(true);
	});

	test("accepts custom_instructions config key", () => {
		const result = clientMessageSchema.safeParse({
			type: "set_config",
			key: "custom_instructions:project-123",
			value: "Use TypeScript",
		});
		expect(result.success).toBe(true);
	});

	test("rejects started config key", () => {
		const result = clientMessageSchema.safeParse({
			type: "set_config",
			key: "started:project-123",
			value: "true",
		});
		expect(result.success).toBe(false);
	});

	test("rejects discovery_fail_streak config key", () => {
		const result = clientMessageSchema.safeParse({
			type: "set_config",
			key: "discovery_fail_streak:project-123",
			value: "0",
		});
		expect(result.success).toBe(false);
	});

	test("rejects arbitrary config key", () => {
		const result = clientMessageSchema.safeParse({
			type: "set_config",
			key: "anything_else:project-123",
			value: "malicious",
		});
		expect(result.success).toBe(false);
	});
});
