import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { isValidTransition } from "../shared/fsm.ts";
import { taskStatusSchema } from "../shared/schema.ts";

// Import DB schema to run table creation/migrations, then DB functions
import "../server/db/schema.ts";
import { getProject, listProjects } from "../server/db/projects.ts";
import { createTask, getTask, listTasks, updateTask } from "../server/db/tasks.ts";

const server = new McpServer({
	name: "autocoder",
	version: "0.1.0",
});

server.tool("list_projects", "List all projects", {}, async () => {
	const projects = listProjects();
	return {
		content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
	};
});

server.tool(
	"add_task",
	"Add a task to a project's queue",
	{
		projectId: z.string().describe("Project ID"),
		prompt: z.string().max(50_000).describe("What the agent should accomplish"),
	},
	async ({ projectId, prompt }) => {
		const project = getProject(projectId);
		if (!project) {
			return {
				content: [{ type: "text", text: `Project not found: ${projectId}` }],
				isError: true,
			};
		}

		const task = createTask(projectId, prompt);
		return {
			content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
		};
	},
);

server.tool(
	"list_tasks",
	"List tasks for a project",
	{
		projectId: z.string().describe("Project ID"),
		status: z.optional(taskStatusSchema).describe("Filter by status"),
	},
	async ({ projectId, status }) => {
		const project = getProject(projectId);
		if (!project) {
			return {
				content: [{ type: "text", text: `Project not found: ${projectId}` }],
				isError: true,
			};
		}

		let tasks = listTasks(projectId);
		if (status) {
			tasks = tasks.filter((t) => t.status === status);
		}
		return {
			content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
		};
	},
);

server.tool(
	"cancel_task",
	"Cancel a queued or running task",
	{
		taskId: z.string().describe("Task ID"),
	},
	async ({ taskId }) => {
		const task = getTask(taskId);
		if (!task) {
			return {
				content: [{ type: "text", text: `Task not found: ${taskId}` }],
				isError: true,
			};
		}

		if (!isValidTransition(task.status, "cancelled")) {
			return {
				content: [
					{
						type: "text",
						text: `Cannot cancel task in status "${task.status}". Only queued or running tasks can be cancelled.`,
					},
				],
				isError: true,
			};
		}

		const updated = updateTask(taskId, "cancelled");
		if (!updated) {
			return {
				content: [{ type: "text", text: `Failed to cancel task ${taskId} (concurrent modification)` }],
				isError: true,
			};
		}

		const note =
			task.status === "running"
				? " (marked as cancelled in DB; the main server's process manager will handle the actual process termination)"
				: "";

		return {
			content: [{ type: "text", text: `Task ${taskId} cancelled successfully${note}` }],
		};
	},
);

export function createMcpServer() {
	return server;
}

if (import.meta.main) {
	const transport = new StdioServerTransport();
	server.connect(transport).catch((err) => {
		console.error("MCP server failed to start:", err);
		process.exit(1);
	});
}
