import { afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskLog } from "../../shared/types.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { buildExecutionPrompt, parseCommitSummary, runVerifyCommand } from "./process.ts";

function createMockDeps(): OrchestratorDeps {
	return {
		db: {
			getProject: mock(() => null),
			listProjects: mock(() => []),
			createTask: mock(() => ({}) as never),
			getTask: mock(() => null),
			listTasks: mock(() => []),
			updateTask: mock(() => null),
			getQueuedTasks: mock(() => []),
			getQueuedTasksByProject: mock(() => []),
			getRunningTasksByProject: mock(() => []),
			appendTaskLog: mock(
				(taskId: string, content: string, stream?: "stdout" | "stderr" | "system") =>
					({ id: "log1", taskId, content, stream: stream ?? "stdout", createdAt: "" }) as TaskLog,
			),
			getProjectConfig: mock(() => null),
			setProjectConfig: mock(() => ({}) as never),
		},
		broadcast: mock(() => {}),
	};
}

describe("buildExecutionPrompt", () => {
	test("wraps task prompt with autonomous execution context", () => {
		const result = buildExecutionPrompt("Fix the null check in user.ts");
		expect(result).toContain("autonomous coding agent");
		expect(result).toContain("Fix the null check in user.ts");
	});

	test("includes guidance about minimal changes and verification", () => {
		const result = buildExecutionPrompt("Add error handling");
		expect(result).toContain("minimal, focused changes");
		expect(result).toContain("verify");
	});

	test("includes commit footer instruction", () => {
		const result = buildExecutionPrompt("Fix bug");
		expect(result).toContain("conventional commit message");
		expect(result).toContain("fix, feat, refactor");
	});

	test("appends verify command instruction when provided", () => {
		const result = buildExecutionPrompt("Fix bug", "bun check && bun test");
		expect(result).toContain("bun check && bun test");
		expect(result).toContain("IMPORTANT: After making changes, run this verification command");
	});

	test("does not include verify instruction when no verify command", () => {
		const result = buildExecutionPrompt("Fix bug");
		expect(result).not.toContain("IMPORTANT: After making changes, run this verification command");
	});
});

describe("parseCommitSummary", () => {
	test("extracts conventional commit from footer separator", async () => {
		const result = await parseCommitSummary(
			"I fixed the bug in the user handler.\n\n---\nfix(auth): handle null user in getUser",
			"Fix null check",
		);
		expect(result).toBe("fix(auth): handle null user in getUser");
	});

	test("extracts commit without scope", async () => {
		const result = await parseCommitSummary("Done.\n\n---\nchore: update dependencies", "Update deps");
		expect(result).toBe("chore: update dependencies");
	});

	test("returns a valid conventional commit even without footer", async () => {
		const result = await parseCommitSummary(
			"I made the changes you asked for.",
			"Fix the authentication bug in login handler",
		);
		// Either Sonnet extracts something or we get the fallback — both should be valid
		expect(result).toMatch(/^(fix|feat|refactor|docs|test|chore|perf|style)(\([^)]*\))?:\s*.+/);
	});
});

describe("runVerifyCommand", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("returns success for a passing command", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		const result = await runVerifyCommand(tempDir, "true", "t1", deps);
		expect(result.success).toBe(true);
	});

	test("returns failure for a failing command", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		const result = await runVerifyCommand(tempDir, "false", "t1", deps);
		expect(result.success).toBe(false);
	});

	test("captures output from the command", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		const result = await runVerifyCommand(tempDir, "echo 'hello world'", "t1", deps);
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello world");
	});

	test("logs output via deps", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		await runVerifyCommand(tempDir, "echo 'test output'", "t1", deps);
		expect(deps.db.appendTaskLog).toHaveBeenCalled();
		expect(deps.broadcast).toHaveBeenCalled();
	});
});
