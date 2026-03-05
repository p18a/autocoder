import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { isValidTransition } from "../shared/fsm.ts";
import { journalTierSchema, taskStatusSchema } from "../shared/schema.ts";

// Import DB schema to run table creation/migrations, then DB functions
import "../server/db/schema.ts";
import {
	appendJournalEntry,
	getJournalEntries,
	getJournalEntriesByTier,
	searchJournalEntries,
} from "../server/db/journal.ts";
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

// ── Dev Journal Tools ────────────────────────────────────────────────

server.tool(
	"read_journal",
	"Read recent dev journal entries for a project. Returns the latest entries across all tiers (historical context first, then summaries, then recent notes). Use this at the start of a task to understand project history and context.",
	{
		projectId: z.string().describe("Project ID"),
		limit: z.number().int().min(1).max(50).optional().describe("Max recent entries to return (default 10)"),
		tier: z
			.optional(journalTierSchema)
			.describe("Filter by tier: 'recent' (full entries), 'summary' (compressed), 'historical' (key decisions)"),
	},
	async ({ projectId, limit, tier }) => {
		const project = getProject(projectId);
		if (!project) {
			return {
				content: [{ type: "text", text: `Project not found: ${projectId}` }],
				isError: true,
			};
		}

		if (tier) {
			const entries = getJournalEntriesByTier(projectId, tier, limit ?? 10);
			return {
				content: [{ type: "text", text: formatJournalEntries(entries, tier) }],
			};
		}

		// Default: show all tiers in context order
		const historical = getJournalEntriesByTier(projectId, "historical", 1);
		const summaries = getJournalEntriesByTier(projectId, "summary", 5);
		const recent = getJournalEntries(projectId, limit ?? 10);

		let output = "";

		if (historical.length > 0) {
			output += "## Historical Context\n\n";
			for (const entry of historical) {
				output += `${entry.content}\n\n`;
			}
		}

		if (summaries.length > 0) {
			output += "## Previous Cycle Summaries\n\n";
			for (const entry of summaries) {
				output += `${entry.content}\n\n`;
			}
		}

		if (recent.length > 0) {
			output += "## Recent Notes\n\n";
			for (const entry of recent) {
				output += `[${entry.createdAt}]\n${entry.content}\n\n`;
			}
		}

		if (!output) {
			output = "No journal entries yet for this project.";
		}

		return {
			content: [{ type: "text", text: output.trim() }],
		};
	},
);

server.tool(
	"write_journal",
	"Write a note to the project's dev journal. Use this to record decisions, discoveries, abandoned approaches, multi-task plans, or anything that would be useful context for future work. Keep entries focused and concise.",
	{
		projectId: z.string().describe("Project ID"),
		content: z.string().min(1).max(5000).describe("The journal entry content"),
	},
	async ({ projectId, content }) => {
		const project = getProject(projectId);
		if (!project) {
			return {
				content: [{ type: "text", text: `Project not found: ${projectId}` }],
				isError: true,
			};
		}

		const entry = appendJournalEntry(projectId, content);
		return {
			content: [{ type: "text", text: `Journal entry recorded (${entry.id})` }],
		};
	},
);

server.tool(
	"search_journal",
	"Search the project's dev journal for entries matching a query. Useful when you need context on a specific topic, module, or past decision.",
	{
		projectId: z.string().describe("Project ID"),
		query: z.string().min(1).describe("Search query (matches against entry content)"),
		limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
	},
	async ({ projectId, query, limit }) => {
		const project = getProject(projectId);
		if (!project) {
			return {
				content: [{ type: "text", text: `Project not found: ${projectId}` }],
				isError: true,
			};
		}

		const entries = searchJournalEntries(projectId, query, limit ?? 10);
		if (entries.length === 0) {
			return {
				content: [{ type: "text", text: `No journal entries matching "${query}"` }],
			};
		}

		let output = `Found ${entries.length} entries matching "${query}":\n\n`;
		for (const entry of entries) {
			output += `[${entry.createdAt}] (${entry.tier})\n${entry.content}\n\n`;
		}

		return {
			content: [{ type: "text", text: output.trim() }],
		};
	},
);

function formatJournalEntries(entries: { createdAt: string; content: string }[], tier: string): string {
	if (entries.length === 0) return `No ${tier} journal entries.`;
	let output = `## ${tier.charAt(0).toUpperCase() + tier.slice(1)} Entries\n\n`;
	for (const entry of entries) {
		output += `[${entry.createdAt}]\n${entry.content}\n\n`;
	}
	return output.trim();
}

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
