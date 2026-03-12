import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../../../shared/types.ts";

const requestLogsMock = mock(() => {});

mock.module("../../stores/commands.ts", () => ({
	sendCancelTask: mock(() => {}),
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

import { HistoryCard, type HistoryCardProps } from "./HistoryCard.tsx";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		projectId: "proj-1",
		title: "Fix login bug",
		prompt: "Fix the login page crash",
		status: "completed",
		taskType: "execution",
		originTaskId: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function renderHistory(overrides: Partial<HistoryCardProps> = {}) {
	const defaults: HistoryCardProps = {
		tasks: [],
		onRetry: mock(() => {}),
		onRemove: mock(() => {}),
		onClear: mock(() => {}),
		...overrides,
	};
	return render(<HistoryCard {...defaults} />);
}

describe("HistoryCard", () => {
	beforeEach(() => {
		requestLogsMock.mockClear();
	});

	afterEach(cleanup);

	test("shows empty state when no tasks", () => {
		renderHistory();
		expect(screen.getByText("No completed tasks yet")).toBeTruthy();
	});

	test("does not show Clear all button when no tasks", () => {
		renderHistory();
		expect(screen.queryByText("Clear all")).toBeNull();
	});

	test("renders completed tasks with check mark", () => {
		const tasks = [makeTask({ id: "t1", title: "Task one", status: "completed" })];
		renderHistory({ tasks });
		expect(screen.getByText(/Task one/)).toBeTruthy();
	});

	test("renders failed tasks with retry button", () => {
		const tasks = [makeTask({ id: "t1", title: "Failed task", status: "failed" })];
		renderHistory({ tasks });
		expect(screen.getByText("failed")).toBeTruthy();
		expect(screen.getByTitle("Retry task")).toBeTruthy();
	});

	test("shows Clear all button when tasks exist", () => {
		const tasks = [makeTask({ id: "t1" })];
		renderHistory({ tasks });
		expect(screen.getByText("Clear all")).toBeTruthy();
	});

	test("calls onClear when Clear all is clicked", () => {
		const onClear = mock(() => {});
		const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
		renderHistory({ tasks, onClear });

		fireEvent.click(screen.getByText("Clear all"));
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	test("calls onRetry when retry button is clicked", () => {
		const onRetry = mock(() => {});
		const tasks = [makeTask({ id: "t1", status: "failed" })];
		renderHistory({ tasks, onRetry });

		fireEvent.click(screen.getByTitle("Retry task"));
		expect(onRetry).toHaveBeenCalledWith("t1");
	});

	test("calls onRemove when remove button is clicked", () => {
		const onRemove = mock(() => {});
		const tasks = [makeTask({ id: "t1", title: "Some task" })];
		renderHistory({ tasks, onRemove });

		const removeButtons = screen
			.getAllByRole("button")
			.filter((btn) => btn.className.includes("hover:text-destructive"));
		expect(removeButtons.length).toBeGreaterThan(0);
		const btn = removeButtons[0];
		if (!btn) throw new Error("Remove button not found");
		fireEvent.click(btn);

		expect(onRemove).toHaveBeenCalledWith("t1");
	});

	test("does not show retry button for completed tasks", () => {
		const tasks = [makeTask({ id: "t1", status: "completed" })];
		renderHistory({ tasks });
		expect(screen.queryByTitle("Retry task")).toBeNull();
	});

	test("shows retry button for cancelled tasks", () => {
		const tasks = [makeTask({ id: "t1", status: "cancelled" })];
		renderHistory({ tasks });
		expect(screen.getByTitle("Retry task")).toBeTruthy();
	});

	test("shows status badge for each task", () => {
		const tasks = [makeTask({ id: "t1", status: "completed" }), makeTask({ id: "t2", status: "failed" })];
		renderHistory({ tasks });
		expect(screen.getByText("completed")).toBeTruthy();
		expect(screen.getByText("failed")).toBeTruthy();
	});
});
