import { beforeEach, describe, expect, test } from "bun:test";
import type { Task, TaskLog } from "../../shared/types.ts";
import { useTasksStore } from "./tasks.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		projectId: "proj-1",
		title: null,
		prompt: "fix bug",
		status: "queued",
		taskType: "execution",
		originTaskId: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeLog(overrides: Partial<TaskLog> = {}): TaskLog {
	return {
		id: "log-1",
		taskId: "task-1",
		content: "output line",
		stream: "stdout",
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("tasks store", () => {
	beforeEach(() => {
		useTasksStore.setState({ tasks: [], logs: {}, logMeta: {} });
	});

	describe("setTasks", () => {
		test("replaces all tasks", () => {
			const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
			useTasksStore.getState().setTasks(tasks);
			expect(useTasksStore.getState().tasks).toEqual(tasks);
		});
	});

	describe("upsertTask", () => {
		test("inserts a new task", () => {
			const task = makeTask({ id: "t1" });
			useTasksStore.getState().upsertTask(task);
			expect(useTasksStore.getState().tasks).toHaveLength(1);
			expect(useTasksStore.getState().tasks[0]).toEqual(task);
		});

		test("updates an existing task by id", () => {
			const task = makeTask({ id: "t1", status: "queued" });
			useTasksStore.getState().setTasks([task]);

			const updated = makeTask({ id: "t1", status: "running" });
			useTasksStore.getState().upsertTask(updated);

			expect(useTasksStore.getState().tasks).toHaveLength(1);
			expect(useTasksStore.getState().tasks[0]?.status).toBe("running");
		});
	});

	describe("removeTask", () => {
		test("removes task and its logs and metadata", () => {
			const task = makeTask({ id: "t1" });
			useTasksStore.getState().setTasks([task]);
			useTasksStore.getState().setLogs("t1", [makeLog({ taskId: "t1" })], 1, false);

			useTasksStore.getState().removeTask("t1");

			expect(useTasksStore.getState().tasks).toHaveLength(0);
			expect(useTasksStore.getState().logs.t1).toBeUndefined();
			expect(useTasksStore.getState().logMeta.t1).toBeUndefined();
		});

		test("does not affect other tasks", () => {
			useTasksStore.getState().setTasks([makeTask({ id: "t1" }), makeTask({ id: "t2" })]);
			useTasksStore.getState().removeTask("t1");
			expect(useTasksStore.getState().tasks).toHaveLength(1);
			expect(useTasksStore.getState().tasks[0]?.id).toBe("t2");
		});
	});

	describe("removeTasksByProject", () => {
		test("removes all tasks for a project and their logs", () => {
			useTasksStore
				.getState()
				.setTasks([
					makeTask({ id: "t1", projectId: "proj-1" }),
					makeTask({ id: "t2", projectId: "proj-1" }),
					makeTask({ id: "t3", projectId: "proj-2" }),
				]);
			useTasksStore.getState().setLogs("t1", [makeLog({ taskId: "t1" })], 1, false);
			useTasksStore.getState().setLogs("t3", [makeLog({ taskId: "t3" })], 1, false);

			useTasksStore.getState().removeTasksByProject("proj-1");

			expect(useTasksStore.getState().tasks).toHaveLength(1);
			expect(useTasksStore.getState().tasks[0]?.id).toBe("t3");
			expect(useTasksStore.getState().logs.t1).toBeUndefined();
			expect(useTasksStore.getState().logs.t3).toBeDefined();
		});
	});

	describe("appendLog", () => {
		test("appends a log entry to a task", () => {
			const log = makeLog({ id: "l1", taskId: "t1" });
			useTasksStore.getState().appendLog(log);

			expect(useTasksStore.getState().logs.t1).toHaveLength(1);
			expect(useTasksStore.getState().logs.t1?.[0]).toEqual(log);
		});

		test("caps logs at 2000 entries", () => {
			const logs = Array.from({ length: 2000 }, (_, i) => makeLog({ id: `l${i}`, taskId: "t1" }));
			useTasksStore.setState({ logs: { t1: logs }, logMeta: {} });

			useTasksStore.getState().appendLog(makeLog({ id: "l-overflow", taskId: "t1" }));

			const stored = useTasksStore.getState().logs.t1;
			expect(stored).toHaveLength(2000);
			expect(stored?.[stored.length - 1]?.id).toBe("l-overflow");
			// Oldest log should have been trimmed
			expect(stored?.[0]?.id).toBe("l1");
		});
	});

	describe("setLogs", () => {
		test("sets logs and metadata for a task", () => {
			const logs = [makeLog({ id: "l1" }), makeLog({ id: "l2" })];
			useTasksStore.getState().setLogs("t1", logs, 50, true);

			expect(useTasksStore.getState().logs.t1).toEqual(logs);
			expect(useTasksStore.getState().logMeta.t1).toEqual({ total: 50, hasMore: true });
		});
	});

	describe("prependLogs", () => {
		test("prepends older logs before existing ones", () => {
			useTasksStore.setState({
				logs: { t1: [makeLog({ id: "l3" }), makeLog({ id: "l4" })] },
				logMeta: {},
			});

			const older = [makeLog({ id: "l1" }), makeLog({ id: "l2" })];
			useTasksStore.getState().prependLogs("t1", older, 100, false);

			const stored = useTasksStore.getState().logs.t1;
			expect(stored).toHaveLength(4);
			expect(stored?.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4"]);
			expect(useTasksStore.getState().logMeta.t1).toEqual({ total: 100, hasMore: false });
		});

		test("handles prepend when no existing logs", () => {
			const older = [makeLog({ id: "l1" })];
			useTasksStore.getState().prependLogs("t1", older, 10, true);

			expect(useTasksStore.getState().logs.t1).toHaveLength(1);
		});
	});
});
