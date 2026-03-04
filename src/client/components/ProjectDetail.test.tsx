import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Project, Task } from "../../shared/types.ts";
import { useConfigStore } from "../stores/config.ts";
import { useConnectionStore } from "../stores/connection.ts";
import { useProjectsStore } from "../stores/sessions.ts";
import { useTasksStore } from "../stores/tasks.ts";

// Mock commands module
const sendStartMock = mock(() => {});
const sendStopMock = mock(() => {});
const sendAddTaskMock = mock(() => {});
const sendDeleteTaskMock = mock(() => {});
const sendRetryTaskMock = mock(() => {});
const sendUpdateConfigMock = mock(() => {});
const sendRequestTaskLogsMock = mock(() => {});
const sendCancelTaskMock = mock(() => {});

mock.module("../stores/commands.ts", () => ({
	sendStartProject: sendStartMock,
	sendStopProject: sendStopMock,
	sendAddTask: sendAddTaskMock,
	sendDeleteTask: sendDeleteTaskMock,
	sendRetryTask: sendRetryTaskMock,
	sendUpdateConfig: sendUpdateConfigMock,
	sendRequestTaskLogs: sendRequestTaskLogsMock,
	sendCancelTask: sendCancelTaskMock,
	sendCreateProject: mock(() => {}),
	sendDeleteProject: mock(() => {}),
	sendRequestServerLogs: mock(() => {}),
}));

// Mock the router
const navigateMock = mock(() => {});
mock.module("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

import { ProjectDetail } from "./ProjectDetail.tsx";

const PROJECT: Project = {
	id: "proj-1",
	name: "Test Project",
	path: "/home/user/project",
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

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

function setupStores(
	options: {
		project?: Project | null;
		tasks?: Task[];
		started?: boolean;
		autoContinue?: boolean;
		initialized?: boolean;
	} = {},
) {
	const { project = PROJECT, tasks = [], started = false, autoContinue = false, initialized = true } = options;

	useProjectsStore.setState({ projects: project ? [project] : [] });
	useTasksStore.setState({ tasks, logs: {}, logMeta: {} });
	useConnectionStore.setState({ initialized });

	const configs: Record<string, string> = {};
	if (started) configs[`started:${PROJECT.id}`] = "true";
	if (autoContinue) configs[`auto_continue:${PROJECT.id}`] = "true";
	useConfigStore.setState({ configs });
}

describe("ProjectDetail", () => {
	beforeEach(() => {
		sendStartMock.mockClear();
		sendStopMock.mockClear();
		sendAddTaskMock.mockClear();
		sendDeleteTaskMock.mockClear();
		sendRetryTaskMock.mockClear();
		sendUpdateConfigMock.mockClear();
		sendRequestTaskLogsMock.mockClear();
		sendCancelTaskMock.mockClear();
		navigateMock.mockClear();
	});

	afterEach(cleanup);

	test("renders null when project not found", () => {
		setupStores({ project: null, initialized: false });
		const { container } = render(<ProjectDetail projectId="proj-1" />);
		expect(container.innerHTML).toBe("");
	});

	test("renders project name and path in header", () => {
		setupStores();
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getByText("Test Project")).toBeTruthy();
		expect(screen.getByText("/home/user/project")).toBeTruthy();
	});

	test("shows Start discovery button when not started and no queued tasks", () => {
		setupStores({ started: false });
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getByText("Start discovery")).toBeTruthy();
	});

	test("shows Start execution button when not started but has queued tasks", () => {
		setupStores({ started: false, tasks: [makeTask({ id: "t1", status: "queued" })] });
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getByText("Start execution")).toBeTruthy();
	});

	test("shows Stop button when started", () => {
		setupStores({ started: true });
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getByText("Stop")).toBeTruthy();
	});

	test("calls sendStartProject in discover mode when clicking Start discovery", () => {
		setupStores({ started: false });
		render(<ProjectDetail projectId="proj-1" />);
		fireEvent.click(screen.getByText("Start discovery"));
		expect(sendStartMock).toHaveBeenCalledWith("proj-1", "discover");
	});

	test("calls sendStartProject in execute mode when clicking Start execution", () => {
		setupStores({ started: false, tasks: [makeTask({ id: "t1", status: "queued" })] });
		render(<ProjectDetail projectId="proj-1" />);
		fireEvent.click(screen.getByText("Start execution"));
		expect(sendStartMock).toHaveBeenCalledWith("proj-1", "execute");
	});

	test("calls sendStopProject when clicking Stop", () => {
		setupStores({ started: true });
		render(<ProjectDetail projectId="proj-1" />);
		fireEvent.click(screen.getByText("Stop"));
		expect(sendStopMock).toHaveBeenCalledWith("proj-1");
	});

	test("renders queue section with queued tasks", () => {
		const tasks = [
			makeTask({ id: "t1", title: "Task one", status: "queued" }),
			makeTask({ id: "t2", title: "Task two", status: "queued" }),
		];
		setupStores({ tasks });
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getByText("Queue (2)")).toBeTruthy();
	});

	test("renders history section with completed/failed tasks", () => {
		const tasks = [
			makeTask({ id: "t1", status: "completed", title: "Done task" }),
			makeTask({ id: "t2", status: "failed", title: "Failed task" }),
		];
		setupStores({ tasks });
		render(<ProjectDetail projectId="proj-1" />);
		expect(screen.getAllByText("History").length).toBeGreaterThan(0);
		expect(screen.getByText(/Done task/)).toBeTruthy();
	});

	test("navigates to home when project disappears after ws init", () => {
		setupStores({ project: null, initialized: true });
		render(<ProjectDetail projectId="proj-1" />);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
	});
});
