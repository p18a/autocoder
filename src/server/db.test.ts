import { describe, expect, test } from "bun:test";
import { IllegalTransitionError } from "../shared/fsm.ts";
import * as db from "./db/index.ts";

describe("Database Operations", () => {
	test("Project CRUD round-trip & deleteProjectCascade", () => {
		const project = db.createProject("Test Project", "/tmp/test");
		expect(project.name).toBe("Test Project");

		const fetched = db.getProject(project.id);
		expect(fetched).toEqual(project);

		// Create a task and a config to test cascade
		const task = db.createTask(project.id, "Test prompt");
		db.setProjectConfig(project.id, "auto_continue", "true");
		db.appendTaskLog(task.id, "Log content", "stdout");

		expect(db.getTask(task.id)).not.toBeNull();
		expect(db.getProjectConfig(project.id, "auto_continue")).toBe("true");
		expect(db.getTaskLogs(task.id).length).toBe(1);

		const deleted = db.deleteProjectCascade(project.id);
		expect(deleted).toBe(true);

		expect(db.getProject(project.id)).toBeNull();
		expect(db.getTask(task.id)).toBeNull();
		expect(db.getProjectConfig(project.id, "auto_continue")).toBeNull();
		expect(db.getTaskLogs(task.id).length).toBe(0);
	});

	test("Task CRUD and originTaskId", () => {
		const project = db.createProject("Task Test Project", "/tmp/task");

		const task1 = db.createTask(project.id, "Prompt 1");
		expect(task1.status).toBe("queued");
		expect(task1.originTaskId).toBeNull();

		const task2 = db.createTask(project.id, "Prompt 2", "execution", task1.id);
		expect(task2.originTaskId).toBe(task1.id);

		const fetched2 = db.getTask(task2.id);
		expect(fetched2?.originTaskId).toBe(task1.id);

		db.deleteProjectCascade(project.id);
	});

	test("updateTask with FSM", () => {
		const project = db.createProject("FSM Test", "/tmp/fsm");
		const task = db.createTask(project.id, "FSM prompt");

		expect(task.status).toBe("queued");

		// valid
		const updated = db.updateTask(task.id, "running");
		expect(updated?.status).toBe("running");

		// invalid
		expect(() => db.updateTask(task.id, "queued")).toThrow(IllegalTransitionError);

		db.deleteProjectCascade(project.id);
	});

	test("CAS: updateTask expectedStatus", () => {
		const project = db.createProject("CAS Test", "/tmp/cas");
		const task = db.createTask(project.id, "CAS prompt");

		// Succeeds
		const updated1 = db.updateTask(task.id, "running", "queued");
		expect(updated1?.status).toBe("running");

		// Repeat returns null
		const updated2 = db.updateTask(task.id, "running", "queued");
		expect(updated2).toBeNull();

		db.deleteProjectCascade(project.id);
	});

	test("removeTask cascades to task logs", () => {
		const project = db.createProject("Remove Test", "/tmp/remove");
		const task = db.createTask(project.id, "Remove prompt");
		db.appendTaskLog(task.id, "Log data", "stdout");
		db.updateTask(task.id, "running");
		db.updateTask(task.id, "completed");

		expect(db.getTaskLogs(task.id).length).toBe(1);

		const removed = db.removeTask(task.id);
		expect(removed).toBe(true);

		expect(db.getTask(task.id)).toBeNull();
		expect(db.getTaskLogs(task.id).length).toBe(0);

		db.deleteProjectCascade(project.id);
	});

	test("removeTask rejects non-terminal task", () => {
		const project = db.createProject("Remove Guard Test", "/tmp/remove-guard");
		const task = db.createTask(project.id, "Queued prompt");

		expect(() => db.removeTask(task.id)).toThrow("non-terminal");

		db.updateTask(task.id, "running");
		expect(() => db.removeTask(task.id)).toThrow("non-terminal");

		db.updateTask(task.id, "cancelled");
		expect(db.removeTask(task.id)).toBe(true);

		db.deleteProjectCascade(project.id);
	});

	test("removeTask returns false for nonexistent task", () => {
		expect(db.removeTask("nonexistent-id")).toBe(false);
	});

	test("row mapping returns camelCase properties from snake_case columns", () => {
		const project = db.createProject("Mapping Test", "/tmp/mapping");
		const task = db.createTask(project.id, "Mapping prompt", "discovery", null, "A title");

		// Project: created_at → createdAt, updated_at → updatedAt
		const fetchedProject = db.getProject(project.id);
		expect(fetchedProject).not.toBeNull();
		expect(fetchedProject?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(fetchedProject?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// Task: project_id → projectId, task_type → taskType, origin_task_id → originTaskId
		const fetchedTask = db.getTask(task.id);
		expect(fetchedTask).not.toBeNull();
		expect(fetchedTask?.projectId).toBe(project.id);
		expect(fetchedTask?.taskType).toBe("discovery");
		expect(fetchedTask?.originTaskId).toBeNull();
		expect(fetchedTask?.title).toBe("A title");
		expect(fetchedTask?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// TaskLog: task_id → taskId, created_at → createdAt
		db.appendTaskLog(task.id, "test content", "stderr");
		const logs = db.getTaskLogs(task.id);
		expect(logs).toHaveLength(1);
		const log = logs[0];
		expect(log).toBeDefined();
		if (!log) throw new Error("expected log");
		expect(log.taskId).toBe(task.id);
		expect(log.stream).toBe("stderr");
		expect(log.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// TaskLog count
		expect(db.getTaskLogCount(task.id)).toBe(1);

		// List queries return camelCase too
		const tasks = db.listTasks(project.id);
		expect(tasks).toHaveLength(1);
		const firstTask = tasks[0];
		expect(firstTask).toBeDefined();
		if (!firstTask) throw new Error("expected task");
		expect(firstTask.projectId).toBe(project.id);

		db.deleteProjectCascade(project.id);
	});

	test("server log row mapping", () => {
		db.insertServerLog("warn", "db", "test warning", '{"key":"val"}');
		const logs = db.getServerLogs(1);
		expect(logs).toHaveLength(1);
		const log = logs[0];
		expect(log).toBeDefined();
		if (!log) throw new Error("expected log");
		expect(log.level).toBe("warn");
		expect(log.source).toBe("db");
		expect(log.message).toBe("test warning");
		expect(log.meta).toBe('{"key":"val"}');
		expect(log.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		expect(db.getServerLogCount()).toBeGreaterThanOrEqual(1);
	});
});
