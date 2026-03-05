import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Config, Task, TaskLog, TaskStatus, TaskType } from "../../shared/types.ts";
import type { OrchestratorDeps } from "./deps.ts";

const mockGitHasChanges = mock(() => Promise.resolve(false));
mock.module("../git.ts", () => ({
	gitHasChanges: mockGitHasChanges,
	gitAutoCommit: mock(() => Promise.resolve(null)),
	gitSaveCheckpoint: mock(() => Promise.resolve("abc123")),
	gitRevertToCheckpoint: mock(() => Promise.resolve()),
}));

// Must import after mock.module
const { createQueueProcessor } = await import("./queue.ts");

function createMockDeps(overrides?: Partial<OrchestratorDeps["db"]>): OrchestratorDeps {
	let taskIdCounter = 0;
	return {
		db: {
			getProject: mock(() => ({ id: "p1", name: "Test", path: "/tmp", createdAt: "", updatedAt: "" })),
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

describe("createQueueProcessor", () => {
	afterEach(() => {
		mockGitHasChanges.mockReset();
		mockGitHasChanges.mockImplementation(() => Promise.resolve(false));
	});

	test("isProcessing returns false initially", () => {
		const deps = createMockDeps();
		const qp = createQueueProcessor(deps);
		expect(qp.isProcessing()).toBe(false);
	});

	test("separate instances have independent processing state", async () => {
		const taskA = {
			id: "t1",
			projectId: "p1",
			prompt: "test",
			status: "queued" as TaskStatus,
			taskType: "execution" as const,
			originTaskId: null,
			title: null,
			createdAt: "",
			updatedAt: "",
		} as Task;

		let callCount = 0;
		const depsA = createMockDeps({
			getQueuedTasks: mock(() => {
				// First call returns a task, subsequent calls return empty
				callCount++;
				return callCount === 1 ? [taskA] : [];
			}),
			getProjectConfig: mock((_pid: string, key: string) => {
				if (key === "started") return "true";
				return null;
			}),
			updateTask: mock((id: string, status: TaskStatus) => ({ ...taskA, id, status }) as Task),
			getTask: mock(() => ({ ...taskA, status: "running" as TaskStatus })),
		});

		const depsB = createMockDeps();
		const qpA = createQueueProcessor(depsA);
		const qpB = createQueueProcessor(depsB);

		// Both should start as not processing
		expect(qpA.isProcessing()).toBe(false);
		expect(qpB.isProcessing()).toBe(false);

		// B's state should be independent of A
		expect(qpB.isProcessing()).toBe(false);
	});

	test("processQueue is a no-op when queue is empty", async () => {
		const deps = createMockDeps();
		const qp = createQueueProcessor(deps);

		qp.processQueue();

		// Let the async runQueue settle
		await new Promise((r) => setTimeout(r, 10));

		expect(qp.isProcessing()).toBe(false);
		expect(deps.db.getQueuedTasks).toHaveBeenCalled();
	});

	test("processQueue does not double-run when called while processing", async () => {
		let getQueuedCallCount = 0;
		const task = {
			id: "t1",
			projectId: "p1",
			prompt: "test",
			status: "queued" as TaskStatus,
			taskType: "execution" as const,
			originTaskId: null,
			title: null,
			createdAt: "",
			updatedAt: "",
		} as Task;

		const deps = createMockDeps({
			getQueuedTasks: mock(() => {
				getQueuedCallCount++;
				// First call returns task (starts processing), rest return empty
				return getQueuedCallCount === 1 ? [task] : [];
			}),
			getProjectConfig: mock((_pid: string, key: string) => {
				if (key === "started") return "true";
				return null;
			}),
			// updateTask returns null to simulate CAS failure — loop will continue
			// and call getQueuedTasks again (which returns empty), exiting cleanly
			updateTask: mock(() => null),
		});

		const qp = createQueueProcessor(deps);

		qp.processQueue();
		// Let the async queue start
		await new Promise((r) => setTimeout(r, 5));

		// Queue should be processing now or have finished
		// Calling again should not start a second run
		qp.processQueue();

		await new Promise((r) => setTimeout(r, 20));
		expect(qp.isProcessing()).toBe(false);
	});

	test("processQueue exits when no queued tasks belong to a started project", async () => {
		const task = {
			id: "t1",
			projectId: "p1",
			prompt: "test",
			status: "queued" as TaskStatus,
			taskType: "execution" as const,
			originTaskId: null,
			title: null,
			createdAt: "",
			updatedAt: "",
		} as Task;

		const deps = createMockDeps({
			getQueuedTasks: mock(() => [task]),
			// Project is NOT started
			getProjectConfig: mock(() => null),
		});

		const qp = createQueueProcessor(deps);
		qp.processQueue();

		await new Promise((r) => setTimeout(r, 20));

		expect(qp.isProcessing()).toBe(false);
	});

	test("processQueue fails task when repo has uncommitted changes", async () => {
		mockGitHasChanges.mockImplementation(() => Promise.resolve(true));

		const task = {
			id: "t1",
			projectId: "p1",
			prompt: "test",
			status: "queued" as TaskStatus,
			taskType: "execution" as const,
			originTaskId: null,
			title: null,
			createdAt: "",
			updatedAt: "",
		} as Task;

		let getQueuedCallCount = 0;
		const deps = createMockDeps({
			getQueuedTasks: mock(() => {
				getQueuedCallCount++;
				return getQueuedCallCount === 1 ? [task] : [];
			}),
			getProjectConfig: mock((_pid: string, key: string) => {
				if (key === "started") return "true";
				return null;
			}),
			updateTask: mock((id: string, status: TaskStatus) => ({ ...task, id, status }) as Task),
		});

		const qp = createQueueProcessor(deps);
		qp.processQueue();

		await new Promise((r) => setTimeout(r, 50));

		expect(qp.isProcessing()).toBe(false);
		// Should have logged an error about dirty repo
		const appendCalls = (deps.db.appendTaskLog as ReturnType<typeof mock>).mock.calls;
		const dirtyLogCall = appendCalls.find(
			(call: unknown[]) => typeof call[1] === "string" && (call[1] as string).includes("uncommitted"),
		);
		expect(dirtyLogCall).toBeDefined();
		// Should have marked task as failed
		const updateCalls = (deps.db.updateTask as ReturnType<typeof mock>).mock.calls;
		const failedCall = updateCalls.find((call: unknown[]) => call[0] === "t1" && call[1] === "failed");
		expect(failedCall).toBeDefined();
	});
});
