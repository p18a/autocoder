import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod/v4";
import * as db from "../server/db/index.ts";
import { createMcpServer } from "./server.ts";

const textContentSchema = z.object({
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
});

function getTextContent(result: unknown): string {
	const parsed = textContentSchema.parse(result);
	const first = parsed.content[0];
	if (!first) throw new Error("Expected at least one content item");
	return first.text;
}

let client: Client;
let mcpServer: ReturnType<typeof createMcpServer>;

beforeAll(async () => {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	mcpServer = createMcpServer();
	client = new Client({ name: "test-client", version: "1.0.0" });

	await mcpServer.connect(serverTransport);
	await client.connect(clientTransport);
});

afterAll(async () => {
	await client.close();
	await mcpServer.close();
});

describe("MCP Server", () => {
	test("lists available tools", async () => {
		const result = await client.listTools();
		const toolNames = result.tools.map((t) => t.name);
		expect(toolNames).toContain("list_projects");
		expect(toolNames).toContain("add_task");
		expect(toolNames).toContain("list_tasks");
		expect(toolNames).toContain("cancel_task");
	});

	test("list_projects returns projects", async () => {
		const project = db.createProject("MCP Test", "/tmp/mcp-test");

		const result = await client.callTool({ name: "list_projects", arguments: {} });
		const text = getTextContent(result);
		const projects = JSON.parse(text);
		const found = projects.find((p: { id: string }) => p.id === project.id);
		expect(found).toBeTruthy();
		expect(found.name).toBe("MCP Test");

		db.deleteProjectCascade(project.id);
	});

	test("add_task creates a queued task", async () => {
		const project = db.createProject("MCP Task Test", "/tmp/mcp-task-test");

		const result = await client.callTool({
			name: "add_task",
			arguments: { projectId: project.id, prompt: "Fix the bug" },
		});
		const task = JSON.parse(getTextContent(result));
		expect(task.projectId).toBe(project.id);
		expect(task.prompt).toBe("Fix the bug");
		expect(task.status).toBe("queued");

		db.deleteProjectCascade(project.id);
	});

	test("add_task returns error for nonexistent project", async () => {
		const result = await client.callTool({
			name: "add_task",
			arguments: { projectId: "nonexistent", prompt: "Fix the bug" },
		});
		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Project not found");
	});

	test("list_tasks returns tasks for a project", async () => {
		const project = db.createProject("MCP List Tasks", "/tmp/mcp-list-tasks");
		db.createTask(project.id, "Task 1");
		db.createTask(project.id, "Task 2");

		const result = await client.callTool({
			name: "list_tasks",
			arguments: { projectId: project.id },
		});
		const tasks = JSON.parse(getTextContent(result));
		expect(tasks.length).toBe(2);

		db.deleteProjectCascade(project.id);
	});

	test("list_tasks filters by status", async () => {
		const project = db.createProject("MCP Filter Tasks", "/tmp/mcp-filter-tasks");
		const task1 = db.createTask(project.id, "Task 1");
		db.createTask(project.id, "Task 2");
		db.updateTask(task1.id, "running");
		db.updateTask(task1.id, "completed");

		const result = await client.callTool({
			name: "list_tasks",
			arguments: { projectId: project.id, status: "queued" },
		});
		const tasks = JSON.parse(getTextContent(result));
		expect(tasks.length).toBe(1);
		expect(tasks[0].status).toBe("queued");

		db.deleteProjectCascade(project.id);
	});

	test("list_tasks returns error for nonexistent project", async () => {
		const result = await client.callTool({
			name: "list_tasks",
			arguments: { projectId: "nonexistent" },
		});
		expect(result.isError).toBe(true);
	});

	test("cancel_task cancels a queued task", async () => {
		const project = db.createProject("MCP Cancel", "/tmp/mcp-cancel");
		const task = db.createTask(project.id, "Cancel me");

		const result = await client.callTool({
			name: "cancel_task",
			arguments: { taskId: task.id },
		});
		expect(result.isError).toBeFalsy();
		expect(getTextContent(result)).toContain("cancelled successfully");

		const updated = db.getTask(task.id);
		expect(updated?.status).toBe("cancelled");

		db.deleteProjectCascade(project.id);
	});

	test("cancel_task returns error for already completed task", async () => {
		const project = db.createProject("MCP Cancel Done", "/tmp/mcp-cancel-done");
		const task = db.createTask(project.id, "Already done");
		db.updateTask(task.id, "running");
		db.updateTask(task.id, "completed");

		const result = await client.callTool({
			name: "cancel_task",
			arguments: { taskId: task.id },
		});
		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Cannot cancel");

		db.deleteProjectCascade(project.id);
	});

	test("cancel_task returns error for nonexistent task", async () => {
		const result = await client.callTool({
			name: "cancel_task",
			arguments: { taskId: "nonexistent" },
		});
		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Task not found");
	});
});

describe("MCP Journal Tools", () => {
	test("lists journal tools", async () => {
		const result = await client.listTools();
		const toolNames = result.tools.map((t) => t.name);
		expect(toolNames).toContain("read_journal");
		expect(toolNames).toContain("write_journal");
		expect(toolNames).toContain("search_journal");
	});

	test("write_journal creates an entry and read_journal returns it", async () => {
		const project = db.createProject("MCP Journal Test", "/tmp/mcp-journal-test");

		const writeResult = await client.callTool({
			name: "write_journal",
			arguments: { projectId: project.id, content: "Auth module uses deprecated bcrypt API" },
		});
		expect(writeResult.isError).toBeFalsy();
		expect(getTextContent(writeResult)).toContain("Journal entry recorded");

		const readResult = await client.callTool({
			name: "read_journal",
			arguments: { projectId: project.id },
		});
		const text = getTextContent(readResult);
		expect(text).toContain("Auth module uses deprecated bcrypt API");
		expect(text).toContain("Recent Notes");

		db.deleteProjectCascade(project.id);
	});

	test("read_journal returns empty message for new project", async () => {
		const project = db.createProject("MCP Journal Empty", "/tmp/mcp-journal-empty");

		const result = await client.callTool({
			name: "read_journal",
			arguments: { projectId: project.id },
		});
		expect(getTextContent(result)).toContain("No journal entries");

		db.deleteProjectCascade(project.id);
	});

	test("read_journal filters by tier", async () => {
		const project = db.createProject("MCP Journal Tier", "/tmp/mcp-journal-tier");

		await client.callTool({
			name: "write_journal",
			arguments: { projectId: project.id, content: "Recent entry" },
		});

		const result = await client.callTool({
			name: "read_journal",
			arguments: { projectId: project.id, tier: "summary" },
		});
		expect(getTextContent(result)).toContain("No summary journal entries");

		db.deleteProjectCascade(project.id);
	});

	test("search_journal finds matching entries", async () => {
		const project = db.createProject("MCP Journal Search", "/tmp/mcp-journal-search");

		await client.callTool({
			name: "write_journal",
			arguments: { projectId: project.id, content: "WebSocket reconnect logic has a race condition in the handshake" },
		});
		await client.callTool({
			name: "write_journal",
			arguments: { projectId: project.id, content: "Database migrations run on startup" },
		});

		const result = await client.callTool({
			name: "search_journal",
			arguments: { projectId: project.id, query: "race condition" },
		});
		const text = getTextContent(result);
		expect(text).toContain("race condition");
		expect(text).not.toContain("Database migrations");

		db.deleteProjectCascade(project.id);
	});

	test("search_journal returns empty for no matches", async () => {
		const project = db.createProject("MCP Journal NoMatch", "/tmp/mcp-journal-nomatch");

		const result = await client.callTool({
			name: "search_journal",
			arguments: { projectId: project.id, query: "nonexistent_term_xyz" },
		});
		expect(getTextContent(result)).toContain("No journal entries matching");

		db.deleteProjectCascade(project.id);
	});

	test("write_journal returns error for nonexistent project", async () => {
		const result = await client.callTool({
			name: "write_journal",
			arguments: { projectId: "nonexistent", content: "test" },
		});
		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Project not found");
	});
});
