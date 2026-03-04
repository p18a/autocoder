import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	sendAddTask,
	sendCancelTask,
	sendCreateProject,
	sendDeleteProject,
	sendDeleteTask,
	sendRequestServerLogs,
	sendRequestTaskLogs,
	sendRetryTask,
	sendStartProject,
	sendStopProject,
	sendUpdateConfig,
} from "./commands.ts";
import { useConnectionStore } from "./connection.ts";

describe("commands", () => {
	const sendMock = mock<(data: string) => boolean>(() => true);

	beforeEach(() => {
		sendMock.mockClear();
		useConnectionStore.setState({ send: sendMock } as never);
	});

	afterEach(() => {
		useConnectionStore.setState({ send: () => false } as never);
	});

	test("sendAddTask sends add_task message", () => {
		sendAddTask("proj-1", "fix the bug");
		expect(sendMock).toHaveBeenCalledTimes(1);
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "add_task", projectId: "proj-1", prompt: "fix the bug" });
	});

	test("sendCancelTask sends cancel_task message", () => {
		sendCancelTask("task-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "cancel_task", taskId: "task-1" });
	});

	test("sendDeleteTask sends remove_task message", () => {
		sendDeleteTask("task-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "remove_task", taskId: "task-1" });
	});

	test("sendRetryTask sends retry_task message", () => {
		sendRetryTask("task-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "retry_task", taskId: "task-1" });
	});

	test("sendRequestTaskLogs sends get_task_logs without before", () => {
		sendRequestTaskLogs("task-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "get_task_logs", taskId: "task-1" });
	});

	test("sendRequestTaskLogs sends get_task_logs with before cursor", () => {
		sendRequestTaskLogs("task-1", "log-99");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "get_task_logs", taskId: "task-1", before: "log-99" });
	});

	test("sendStartProject sends start_project message", () => {
		sendStartProject("proj-1", "discover");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "start_project", projectId: "proj-1", mode: "discover" });
	});

	test("sendStopProject sends stop_project message", () => {
		sendStopProject("proj-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "stop_project", projectId: "proj-1" });
	});

	test("sendCreateProject returns send result", () => {
		sendMock.mockReturnValueOnce(true);
		expect(sendCreateProject("My App", "/path")).toBe(true);
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "create_project", name: "My App", path: "/path" });
	});

	test("sendDeleteProject sends delete_project message", () => {
		sendDeleteProject("proj-1");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "delete_project", projectId: "proj-1" });
	});

	test("sendUpdateConfig sends set_config message", () => {
		sendUpdateConfig("auto_continue:proj-1", "true");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "set_config", key: "auto_continue:proj-1", value: "true" });
	});

	test("sendRequestServerLogs sends get_server_logs with default limit", () => {
		sendRequestServerLogs();
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "get_server_logs", limit: 200 });
	});

	test("sendRequestServerLogs includes level when provided", () => {
		sendRequestServerLogs(100, "error");
		const msg = JSON.parse(sendMock.mock.calls[0][0]);
		expect(msg).toEqual({ type: "get_server_logs", limit: 100, level: "error" });
	});
});
