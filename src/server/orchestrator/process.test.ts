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

	test("injects verify command into guidelines when provided", () => {
		const result = buildExecutionPrompt("Fix bug", "bun check && bun test");
		expect(result).toContain("run `bun check && bun test`");
	});

	test("uses generic verify instruction when no verify command", () => {
		const result = buildExecutionPrompt("Fix bug");
		expect(result).toContain("run the project's test suite or type checker if available");
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

	test("returns fallback conventional commit when no footer present", async () => {
		// Mock Bun.spawn to simulate Sonnet failure so we hit the tier-3 fallback
		const originalSpawn = Bun.spawn;
		Bun.spawn = (() => {
			const proc = originalSpawn(["false"], { stdout: "pipe", stderr: "pipe" });
			return proc;
		}) as typeof Bun.spawn;
		try {
			const result = await parseCommitSummary(
				"I made the changes you asked for.",
				"Fix the authentication bug in login handler",
			);
			expect(result).toBe("chore: Fix the authentication bug in login handler");
		} finally {
			Bun.spawn = originalSpawn;
		}
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

	test("captures structured output with exit code first to survive truncation", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		const result = await runVerifyCommand(tempDir, "echo 'hello world'", "t1", deps);
		expect(result.success).toBe(true);
		expect(result.output).toStartWith("[exit code] 0");
		expect(result.output).toContain("[stdout]");
		expect(result.output).toContain("hello world");
	});

	test("includes exit code in failure output", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		const result = await runVerifyCommand(tempDir, "echo 'oops' >&2; exit 2", "t1", deps);
		expect(result.success).toBe(false);
		expect(result.output).toContain("[stderr]");
		expect(result.output).toContain("oops");
		expect(result.output).toContain("[exit code] 2");
	});

	test("logs exit code, stdout, stderr, and status as separate entries", async () => {
		tempDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "verify-"));
		const deps = createMockDeps();
		await runVerifyCommand(tempDir, "echo 'out'; echo 'err' >&2", "t1", deps);

		const calls = (deps.db.appendTaskLog as ReturnType<typeof mock>).mock.calls;
		const contents = calls.map((c: unknown[]) => c[1] as string);

		// Should have: "Running verify...", exit code, stderr, stdout, status
		expect(contents.some((c) => c.startsWith("Verify exit code:"))).toBe(true);
		expect(contents.some((c) => c.startsWith("[stderr]"))).toBe(true);
		expect(contents.some((c) => c.startsWith("[stdout]"))).toBe(true);
		expect(contents.some((c) => c === "Verification passed")).toBe(true);
		expect(deps.broadcast).toHaveBeenCalled();
	});
});
