/**
 * MCP Server stub.
 * Will expose autocoder functionality as MCP tools.
 *
 * Tools planned:
 * - list_projects: List all projects
 * - add_task: Add a task to a project's queue
 * - list_tasks: List tasks for a project
 * - cancel_task: Cancel a queued/running task
 */

// import * as db from "../server/db.ts"; // Will be used when implementing tool handlers

// Stub: basic stdio MCP server skeleton
// Will be implemented with proper MCP protocol handling

const server = {
	name: "autocoder",
	version: "0.1.0",
	tools: {
		list_projects: {
			description: "List all projects",
			parameters: {},
		},
		add_task: {
			description: "Add a task to a project's queue",
			parameters: {
				projectId: { type: "string", description: "Project ID" },
				prompt: { type: "string", description: "What the agent should accomplish" },
			},
		},
		list_tasks: {
			description: "List tasks for a project",
			parameters: {
				projectId: { type: "string", description: "Project ID" },
			},
		},
		cancel_task: {
			description: "Cancel a queued or running task",
			parameters: {
				taskId: { type: "string", description: "Task ID" },
			},
		},
	},
};

console.log(`MCP server "${server.name}" v${server.version} ready (stub)`);
console.log(`Available tools: ${Object.keys(server.tools).join(", ")}`);

// Keep process alive for stdio mode
process.stdin.resume();
