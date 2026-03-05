import { describe, expect, mock, test } from "bun:test";
import type { Config, Project, Task, TaskLog, TaskStatus, TaskType } from "../../shared/types.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { buildAutopilotPrompt, buildDiscoveryPrompt, countTasksFromDiscovery } from "./discovery.ts";

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

describe("buildDiscoveryPrompt", () => {
	test("returns base prompt with MCP add_task instructions", () => {
		const deps = createMockDeps();
		const result = buildDiscoveryPrompt("p1", deps);
		expect(result).toContain("autonomous code reviewer");
		expect(result).toContain("add_task");
		expect(result).toContain("p1"); // PROJECT_ID interpolated
		expect(result).toContain("janitor"); // DISCOVERY_MODE interpolated
		expect(result).toContain("{{TASK_ID}}"); // Left as placeholder for queue to fill
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

describe("buildAutopilotPrompt", () => {
	test("returns autopilot prompt with project goals and MCP instructions", () => {
		const deps = createMockDeps({
			getProjectConfig: mock((_pid: string, key: string) => (key === "project_purpose" ? "Build a todo app" : null)),
		});
		const result = buildAutopilotPrompt("p1", deps);
		expect(result).toContain("autonomous product developer");
		expect(result).toContain("Build a todo app");
		expect(result).toContain("add_task");
		expect(result).toContain("autopilot"); // DISCOVERY_MODE interpolated
	});

	test("falls back to janitor when no project purpose set", () => {
		const deps = createMockDeps();
		const result = buildAutopilotPrompt("p1", deps);
		expect(result).toContain("autonomous code reviewer"); // Janitor prompt
		expect(result).toContain("janitor");
	});

	test("includes custom instructions alongside project goals", () => {
		const deps = createMockDeps({
			getProjectConfig: mock((_pid: string, key: string) => {
				if (key === "project_purpose") return "Build a todo app";
				if (key === "custom_instructions") return "Use React";
				return null;
			}),
		});
		const result = buildAutopilotPrompt("p1", deps);
		expect(result).toContain("Build a todo app");
		expect(result).toContain("Use React");
	});
});

describe("countTasksFromDiscovery", () => {
	test("counts tasks with matching originTaskId", () => {
		const deps = createMockDeps({
			listTasks: mock(() => [
				{ id: "t1", originTaskId: "disc1", projectId: "p1" } as Task,
				{ id: "t2", originTaskId: "disc1", projectId: "p1" } as Task,
				{ id: "t3", originTaskId: "disc2", projectId: "p1" } as Task,
				{ id: "t4", originTaskId: null, projectId: "p1" } as Task,
			]),
		});

		expect(countTasksFromDiscovery("disc1", "p1", deps)).toBe(2);
		expect(countTasksFromDiscovery("disc2", "p1", deps)).toBe(1);
		expect(countTasksFromDiscovery("disc3", "p1", deps)).toBe(0);
	});

	test("returns 0 when no tasks exist", () => {
		const deps = createMockDeps();
		expect(countTasksFromDiscovery("disc1", "p1", deps)).toBe(0);
	});
});
