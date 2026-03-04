import { describe, expect, mock, test } from "bun:test";
import type { Config, Project, Task, TaskLog, TaskStatus, TaskType } from "../../shared/types.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { cancelTask, isProjectStarted, recoverStaleTasks, startProject, stopProject } from "./project.ts";

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
			updateTask: mock((id: string, status: TaskStatus) => ({ id, status }) as Task),
			getQueuedTasks: mock(() => []),
			getQueuedTasksByProject: mock(() => []),
			getRunningTasksByProject: mock(() => []),
			appendTaskLog: mock(
				(taskId: string, content: string, stream?: "stdout" | "stderr" | "system") =>
					({ id: "log1", taskId, content, stream: stream ?? "stdout", createdAt: "" }) as TaskLog,
			),
			getProjectConfig: mock(() => null),
			setProjectConfig: mock(
				(projectId: string, key: string, value: string) => ({ key: `${key}:${projectId}`, value }) as Config,
			),
			...overrides,
		},
		broadcast: mock(() => {}),
	};
}

describe("isProjectStarted", () => {
	test("returns true when config is 'true'", () => {
		const deps = createMockDeps({
			getProjectConfig: mock(() => "true"),
		});
		expect(isProjectStarted("p1", deps)).toBe(true);
	});

	test("returns false when config is null", () => {
		const deps = createMockDeps({
			getProjectConfig: mock(() => null),
		});
		expect(isProjectStarted("p1", deps)).toBe(false);
	});

	test("returns false when config is 'false'", () => {
		const deps = createMockDeps({
			getProjectConfig: mock(() => "false"),
		});
		expect(isProjectStarted("p1", deps)).toBe(false);
	});
});

describe("startProject", () => {
	test("sets started flag and broadcasts config_updated", () => {
		const deps = createMockDeps();
		startProject(
			"p1",
			"execute",
			deps,
			mock(() => {}),
		);

		expect(deps.db.setProjectConfig).toHaveBeenCalledWith("p1", "started", "true");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "config_updated" }));
	});

	test("resets discovery_fail_streak on start", () => {
		const deps = createMockDeps();
		startProject(
			"p1",
			"execute",
			deps,
			mock(() => {}),
		);

		expect(deps.db.setProjectConfig).toHaveBeenCalledWith("p1", "discovery_fail_streak", "0");
	});

	test("seeds a discovery task in discover mode when queue is empty", () => {
		const deps = createMockDeps();
		startProject(
			"p1",
			"discover",
			deps,
			mock(() => {}),
		);

		expect(deps.db.createTask).toHaveBeenCalled();
		const calls = (deps.db.createTask as ReturnType<typeof mock>).mock.calls;
		expect(calls[0]?.[0]).toBe("p1");
		expect(calls[0]?.[2]).toBe("discovery");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "task_added" }));
	});

	test("skips discovery task creation when queued tasks exist", () => {
		const deps = createMockDeps({
			getQueuedTasksByProject: mock(() => [{ id: "existing" } as Task]),
		});
		startProject(
			"p1",
			"discover",
			deps,
			mock(() => {}),
		);

		expect(deps.db.createTask).not.toHaveBeenCalled();
	});

	test("does not create discovery task in execute mode", () => {
		const deps = createMockDeps();
		startProject(
			"p1",
			"execute",
			deps,
			mock(() => {}),
		);

		expect(deps.db.createTask).not.toHaveBeenCalled();
	});
});

describe("stopProject", () => {
	test("returns early if project does not exist", () => {
		const deps = createMockDeps({
			getProject: mock(() => null),
		});
		const result = stopProject("p1", deps);

		expect(result.cancelled).toHaveLength(0);
		expect(deps.db.setProjectConfig).not.toHaveBeenCalled();
	});

	test("sets started flag to false and cancels running tasks", () => {
		const runningTask = { id: "t1", projectId: "p1", status: "running" } as Task;
		const deps = createMockDeps({
			getRunningTasksByProject: mock(() => [runningTask]),
			updateTask: mock((_id: string, status: TaskStatus) => ({ ...runningTask, status }) as Task),
		});

		const result = stopProject("p1", deps);

		expect(deps.db.setProjectConfig).toHaveBeenCalledWith("p1", "started", "false");
		expect(result.cancelled).toHaveLength(1);
		expect(result.cancelled[0]?.status).toBe("cancelled");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "task_updated" }));
	});
});

describe("cancelTask", () => {
	test("cancels a queued task", () => {
		const task = { id: "t1", projectId: "p1", status: "queued" } as Task;
		const deps = createMockDeps({
			getTask: mock(() => task),
			updateTask: mock(() => ({ ...task, status: "cancelled" }) as Task),
		});

		cancelTask("t1", deps);

		expect(deps.db.updateTask).toHaveBeenCalledWith("t1", "cancelled");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "task_updated" }));
	});

	test("does nothing for completed task", () => {
		const task = { id: "t1", projectId: "p1", status: "completed" } as Task;
		const deps = createMockDeps({
			getTask: mock(() => task),
		});

		cancelTask("t1", deps);

		expect(deps.db.updateTask).not.toHaveBeenCalled();
	});

	test("does nothing for non-existent task", () => {
		const deps = createMockDeps({
			getTask: mock(() => null),
		});

		cancelTask("nonexistent", deps);

		expect(deps.db.updateTask).not.toHaveBeenCalled();
	});
});

describe("recoverStaleTasks", () => {
	test("marks stale running tasks as failed and broadcasts updates", () => {
		const staleTask = { id: "t1", projectId: "p1", status: "running" } as Task;
		const deps = createMockDeps({
			listTasks: mock(() => [staleTask]),
			updateTask: mock(() => ({ ...staleTask, status: "failed" }) as Task),
		});

		recoverStaleTasks(deps);

		expect(deps.db.appendTaskLog).toHaveBeenCalledWith("t1", "Task was still running when server restarted", "stderr");
		expect(deps.db.updateTask).toHaveBeenCalledWith("t1", "failed");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "task_log" }));
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "task_updated" }));
	});

	test("stops started projects with no queued work and auto-continue off", () => {
		const project = { id: "p1", name: "Test", path: "/tmp", createdAt: "", updatedAt: "" } as Project;
		const deps = createMockDeps({
			listTasks: mock(() => []),
			listProjects: mock(() => [project]),
			getProjectConfig: mock((_projectId: string, key: string) => {
				if (key === "started") return "true";
				if (key === "auto_continue") return "false";
				return null;
			}),
		});

		recoverStaleTasks(deps);

		expect(deps.db.setProjectConfig).toHaveBeenCalledWith("p1", "started", "false");
		expect(deps.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "config_updated" }));
	});
});
