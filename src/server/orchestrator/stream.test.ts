import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project, Task } from "../../shared/types.ts";
import * as db from "../db/index.ts";
import { createDefaultDeps } from "./deps.ts";
import { handleStdoutLine } from "./stream.ts";

describe("handleStdoutLine", () => {
	let task: Task;
	let project: Project;
	let deps: Awaited<ReturnType<typeof createDefaultDeps>>;

	beforeEach(async () => {
		deps = await createDefaultDeps();
		project = db.createProject("Test", "/tmp");
		task = db.createTask(project.id, "Test task");
	});

	afterEach(() => {
		db.deleteProjectCascade(project.id);
	});

	test("text block creates log and returns textBlock", () => {
		const json = JSON.stringify({
			type: "content_block_start",
			content_block: { type: "text", text: "Hello" },
		});
		const result = handleStdoutLine(json, task.id, deps);
		expect(result.resultText).toBeUndefined();
		expect(result.textBlock).toBe("Hello");

		const logs = db.getTaskLogs(task.id);
		expect(logs.length).toBe(1);
		expect(logs[0]?.content).toBe("Hello");
		expect(logs[0]?.stream).toBe("stdout");
	});

	test("tool_use creates system log and returns no result", () => {
		const json = JSON.stringify({
			type: "content_block_start",
			content_block: { type: "tool_use", name: "my_tool" },
		});
		const result = handleStdoutLine(json, task.id, deps);
		expect(result.resultText).toBeUndefined();
		expect(result.textBlock).toBeUndefined();

		const logs = db.getTaskLogs(task.id);
		expect(logs.length).toBe(1);
		expect(logs[0]?.content).toBe("Tool: my_tool");
		expect(logs[0]?.stream).toBe("system");
	});

	test("result type returns resultText", () => {
		const json = JSON.stringify({
			type: "result",
			result: "Finished",
		});
		const result = handleStdoutLine(json, task.id, deps);
		expect(result.resultText).toBe("Finished");

		const logs = db.getTaskLogs(task.id);
		expect(logs.length).toBe(0);
	});

	test("non-JSON line is logged as stdout and returns empty result", () => {
		const result = handleStdoutLine("not json", task.id, deps);
		expect(result.resultText).toBeUndefined();
		expect(result.textBlock).toBeUndefined();

		const logs = db.getTaskLogs(task.id);
		expect(logs.length).toBe(1);
		expect(logs[0]?.content).toBe("not json");
		expect(logs[0]?.stream).toBe("stdout");
	});
});
