import { describe, expect, mock, test } from "bun:test";
import type { Config, Project, ServerMessage, Task, TaskLog, TaskStatus, TaskType } from "../../shared/types.ts";
import type { OrchestratorDeps } from "./deps.ts";
import {
	buildDiscoveryPrompt,
	dedupeIssues,
	enqueueDiscoveryIssues,
	parseDiscoveryMarkdown,
	parseDiscoveryResult,
	postProcessDiscovery,
} from "./discovery.ts";

function createMockDeps(overrides?: Partial<OrchestratorDeps["db"]>): OrchestratorDeps {
	let taskIdCounter = 0;
	return {
		db: {
			getProject: mock(() => ({ id: "p1", name: "Test", path: "/tmp", createdAt: "", updatedAt: "" }) as Project),
			listProjects: mock(() => []),
			createTask: mock(
				(projectId: string, prompt: string, taskType?: TaskType, originTaskId?: string | null, title?: string | null) =>
					({
						id: `t${++taskIdCounter}`,
						projectId,
						prompt,
						status: "queued" as TaskStatus,
						taskType: taskType ?? "execution",
						originTaskId: originTaskId ?? null,
						title: title ?? null,
						createdAt: "",
						updatedAt: "",
					}) as Task,
			),
			getTask: mock(() => null),
			listTasks: mock(() => []),
			updateTask: mock((_id: string, status: TaskStatus) => ({ id: "t1", status }) as Task),
			getQueuedTasks: mock(() => []),
			getQueuedTasksByProject: mock(() => []),
			getRunningTasksByProject: mock(() => []),
			appendTaskLog: mock(
				(taskId: string, content: string, stream?: "stdout" | "stderr" | "system") =>
					({ id: "log1", taskId, content, stream: stream ?? "stdout", createdAt: "" }) as TaskLog,
			),
			getProjectConfig: mock(() => null),
			setProjectConfig: mock((_projectId: string, key: string, value: string) => ({ key, value }) as Config),
			...overrides,
		},
		broadcast: mock(() => {}),
	};
}

describe("parseDiscoveryResult", () => {
	test("parses valid JSON array", () => {
		const json = JSON.stringify([
			{ title: "Bug 1", prompt: "Fix bug 1" },
			{ title: "Bug 2", prompt: "Fix bug 2" },
		]);
		const result = parseDiscoveryResult(json);
		expect(result).toEqual([
			{ title: "Bug 1", prompt: "Fix bug 1" },
			{ title: "Bug 2", prompt: "Fix bug 2" },
		]);
	});

	test("returns null for invalid JSON", () => {
		expect(parseDiscoveryResult("not json")).toBeNull();
	});

	test("returns null for wrong schema", () => {
		expect(parseDiscoveryResult(JSON.stringify({ not: "an array" }))).toBeNull();
		expect(parseDiscoveryResult(JSON.stringify([{ title: "No prompt" }]))).toBeNull();
	});

	test("returns null for empty strings", () => {
		expect(parseDiscoveryResult(JSON.stringify([{ title: "", prompt: "" }]))).toBeNull();
	});
});

describe("parseDiscoveryMarkdown", () => {
	test("parses standard # headings with --- separators", () => {
		const text = `# Missing null check
In src/foo.ts, add a null check on line 42.
---
# SQL injection
In src/bar.ts, use parameterized queries.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(2);
		expect(issues[0]?.title).toBe("Missing null check");
		expect(issues[0]?.prompt).toContain("null check");
		expect(issues[1]?.title).toBe("SQL injection");
	});

	test("handles ## and ### headings", () => {
		const text = `## Missing null check
Fix the null check.
---
### SQL injection
Fix the injection.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(2);
		expect(issues[0]?.title).toBe("Missing null check");
		expect(issues[1]?.title).toBe("SQL injection");
	});

	test("handles *** and ___ separators", () => {
		const text = `# Issue A
Fix A.
***
# Issue B
Fix B.
___
# Issue C
Fix C.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(3);
	});

	test("tolerates preamble text before first heading", () => {
		const text = `Here are the issues I found:

# Missing null check
Fix it.
---
# SQL injection
Fix that too.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(2);
	});

	test("skips sections without headings", () => {
		const text = `Just some random text
---
# Real issue
Fix this.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.title).toBe("Real issue");
	});

	test("skips headings without prompt body", () => {
		const text = "# Heading only";
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(0);
	});

	test("returns empty array for empty input", () => {
		expect(parseDiscoveryMarkdown("")).toHaveLength(0);
		expect(parseDiscoveryMarkdown("no headings here")).toHaveLength(0);
	});

	test("handles extended --- separators", () => {
		const text = `# Issue A
Fix A.
------
# Issue B
Fix B.`;
		const issues = parseDiscoveryMarkdown(text);
		expect(issues).toHaveLength(2);
	});
});

describe("dedupeIssues", () => {
	test("dedupes within batch", () => {
		const issues = [
			{ title: "A", prompt: "Fix A" },
			{ title: "A", prompt: "Fix A " },
			{ title: "A", prompt: " FIX A" },
			{ title: "B", prompt: "Fix B" },
		];
		const deduped = dedupeIssues(issues, []);
		expect(deduped.length).toBe(2);
		expect(deduped[0]?.prompt).toBe("Fix A");
		expect(deduped[1]?.prompt).toBe("Fix B");
	});

	test("dedupes against existing tasks", () => {
		const issues = [
			{ title: "A", prompt: "Fix A" },
			{ title: "B", prompt: "Fix B" },
		];
		const existing = [{ prompt: " fix a " }];
		const deduped = dedupeIssues(issues, existing);
		expect(deduped.length).toBe(1);
		expect(deduped[0]?.prompt).toBe("Fix B");
	});

	test("case insensitive and whitespace trimmed", () => {
		const issues = [{ title: "A", prompt: "  Fix  " }];
		const existing = [{ prompt: "fix" }];
		const deduped = dedupeIssues(issues, existing);
		expect(deduped.length).toBe(0);
	});
});

describe("buildDiscoveryPrompt", () => {
	test("returns base prompt when no custom instructions set", () => {
		const deps = createMockDeps();
		const result = buildDiscoveryPrompt("p1", deps);
		expect(result).toContain("autonomous code reviewer");
		expect(result).not.toContain("Additional focus areas");
	});

	test("appends custom instructions when set", () => {
		const deps = createMockDeps({
			getProjectConfig: mock((_pid: string, key: string) =>
				key === "custom_instructions" ? "Focus on security" : null,
			),
		});
		const result = buildDiscoveryPrompt("p1", deps);
		expect(result).toContain("Additional focus areas");
		expect(result).toContain("Focus on security");
	});
});

describe("enqueueDiscoveryIssues", () => {
	test("creates execution tasks and broadcasts task_added for each", () => {
		const deps = createMockDeps();
		const issues = [
			{ title: "Bug A", prompt: "Fix A" },
			{ title: "Bug B", prompt: "Fix B" },
		];

		enqueueDiscoveryIssues("disc1", "p1", issues, deps);

		expect(deps.db.createTask).toHaveBeenCalledTimes(2);
		const broadcasts = (deps.broadcast as ReturnType<typeof mock>).mock.calls
			.map((c) => (c[0] as ServerMessage).type)
			.filter((t) => t === "task_added");
		expect(broadcasts).toHaveLength(2);
	});

	test("deduplicates against existing queued tasks", () => {
		const deps = createMockDeps({
			getQueuedTasksByProject: mock(() => [{ prompt: "Fix A" } as Task]),
		});
		const issues = [
			{ title: "Bug A", prompt: "Fix A" },
			{ title: "Bug B", prompt: "Fix B" },
		];

		enqueueDiscoveryIssues("disc1", "p1", issues, deps);

		expect(deps.db.createTask).toHaveBeenCalledTimes(1);
		const calls = (deps.db.createTask as ReturnType<typeof mock>).mock.calls;
		expect(calls[0]?.[1]).toBe("Fix B");
	});

	test("caps issues to MAX_DISCOVERY_ISSUES and logs cap message", () => {
		const deps = createMockDeps();
		// Create 25 issues (exceeds MAX_DISCOVERY_ISSUES = 20)
		const issues = Array.from({ length: 25 }, (_, i) => ({
			title: `Bug ${i}`,
			prompt: `Fix bug ${i}`,
		}));

		enqueueDiscoveryIssues("disc1", "p1", issues, deps);

		expect(deps.db.createTask).toHaveBeenCalledTimes(20);
		// Should have a system log about capping
		expect(deps.db.appendTaskLog).toHaveBeenCalledWith("disc1", expect.stringContaining("capped to"), "system");
	});
});

describe("postProcessDiscovery", () => {
	test("extracts issues from markdown and broadcasts progress logs", () => {
		const deps = createMockDeps();
		const markdown = `# Missing null check
Fix the null check in foo.ts.
---
# SQL injection
Use parameterized queries in bar.ts.`;

		const result = postProcessDiscovery("t1", "p1", markdown, deps);

		expect(result).toHaveLength(2);
		expect(result?.[0]?.title).toBe("Missing null check");

		// Should have broadcast post-processing log and extraction count log
		const logCalls = (deps.db.appendTaskLog as ReturnType<typeof mock>).mock.calls;
		expect(logCalls.some((c) => (c[1] as string).includes("Post-processing"))).toBe(true);
		expect(logCalls.some((c) => (c[1] as string).includes("Extracted 2"))).toBe(true);
	});

	test("returns null when no issues found in text", () => {
		const deps = createMockDeps();
		const result = postProcessDiscovery("t1", "p1", "Just some plain text", deps);

		expect(result).toBeNull();
	});
});
