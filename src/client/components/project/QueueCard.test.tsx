import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../../../shared/types.ts";

const cancelMock = mock(() => {});
const requestLogsMock = mock(() => {});

mock.module("../../stores/commands.ts", () => ({
	sendCancelTask: cancelMock,
	sendRequestTaskLogs: requestLogsMock,
	sendAddTask: mock(() => {}),
	sendDeleteTask: mock(() => {}),
	sendRetryTask: mock(() => {}),
	sendStartProject: mock(() => {}),
	sendStopProject: mock(() => {}),
	sendUpdateConfig: mock(() => {}),
	sendCreateProject: mock(() => {}),
	sendDeleteProject: mock(() => {}),
	sendRequestServerLogs: mock(() => {}),
}));

import { QueueCard, type QueueCardProps } from "./QueueCard.tsx";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		projectId: "proj-1",
		title: "Fix login bug",
		prompt: "Fix the login page crash",
		status: "queued",
		taskType: "execution",
		originTaskId: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function renderQueue(overrides: Partial<QueueCardProps> = {}) {
	const defaults: QueueCardProps = {
		tasks: [],
		activeTask: undefined,
		projectId: "proj-1",
		onAddTask: mock(() => {}),
		newPrompt: "",
		onNewPromptChange: mock(() => {}),
		...overrides,
	};
	return render(<QueueCard {...defaults} />);
}

describe("QueueCard", () => {
	beforeEach(() => {
		cancelMock.mockClear();
		requestLogsMock.mockClear();
	});

	afterEach(cleanup);

	test("shows empty state when no tasks and no active task", () => {
		renderQueue();
		expect(screen.getByText("No tasks queued")).toBeTruthy();
	});

	test("renders queue count in header", () => {
		const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
		renderQueue({ tasks });
		expect(screen.getByText("Queue (2)")).toBeTruthy();
	});

	test("renders queued tasks with labels", () => {
		const tasks = [makeTask({ id: "t1", title: "Task one" }), makeTask({ id: "t2", title: "Task two" })];
		renderQueue({ tasks });
		expect(screen.getByText("Task one")).toBeTruthy();
		expect(screen.getByText("Task two")).toBeTruthy();
	});

	test("shows active task with running badge", () => {
		const active = makeTask({ id: "t-active", status: "running", title: "Running task" });
		renderQueue({ activeTask: active });
		expect(screen.getByText("Running task")).toBeTruthy();
		expect(screen.getByText("running")).toBeTruthy();
	});

	test("calls onAddTask when pressing Enter with a prompt", () => {
		const onAddTask = mock(() => {});
		renderQueue({ onAddTask, newPrompt: "new task prompt" });

		const input = screen.getByPlaceholderText("Add a task...");
		fireEvent.keyDown(input, { key: "Enter" });

		expect(onAddTask).toHaveBeenCalledWith("proj-1", "new task prompt");
	});

	test("calls onAddTask when clicking Add button", () => {
		const onAddTask = mock(() => {});
		renderQueue({ onAddTask, newPrompt: "another task" });

		fireEvent.click(screen.getByText("Add"));

		expect(onAddTask).toHaveBeenCalledWith("proj-1", "another task");
	});

	test("calls onNewPromptChange to clear input after adding a task", () => {
		const onNewPromptChange = mock(() => {});
		renderQueue({ newPrompt: "task", onNewPromptChange });

		fireEvent.click(screen.getByText("Add"));

		expect(onNewPromptChange).toHaveBeenCalledWith("");
	});

	test("calls onNewPromptChange when typing", () => {
		const onNewPromptChange = mock(() => {});
		renderQueue({ onNewPromptChange });

		const input = screen.getByPlaceholderText("Add a task...");
		fireEvent.change(input, { target: { value: "hello" } });

		expect(onNewPromptChange).toHaveBeenCalledWith("hello");
	});

	test("does not add task with empty prompt", () => {
		const onAddTask = mock(() => {});
		renderQueue({ onAddTask, newPrompt: "   " });

		const input = screen.getByPlaceholderText("Add a task...");
		fireEvent.keyDown(input, { key: "Enter" });

		expect(onAddTask).not.toHaveBeenCalled();
	});

	test("Add button is disabled when input is empty", () => {
		renderQueue({ newPrompt: "" });
		const button = screen.getByText("Add");
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	test("calls sendCancelTask when clicking cancel on a queued task", () => {
		const tasks = [makeTask({ id: "t1", title: "Some task" })];
		renderQueue({ tasks });

		const cancelButtons = screen
			.getAllByRole("button")
			.filter((btn) => btn.className.includes("hover:text-destructive"));
		expect(cancelButtons.length).toBeGreaterThan(0);
		const btn = cancelButtons[0];
		if (!btn) throw new Error("Expected cancel button");
		fireEvent.click(btn);

		expect(cancelMock).toHaveBeenCalledWith("t1");
	});
});
