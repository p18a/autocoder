import { z } from "zod/v4";

export const taskStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export const taskTypeSchema = z.enum(["discovery", "execution"]);
export const logStreamSchema = z.enum(["stdout", "stderr", "system"]);

export const projectSchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const taskSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	title: z.string().nullable(),
	prompt: z.string(),
	status: taskStatusSchema,
	taskType: taskTypeSchema,
	originTaskId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const taskLogSchema = z.object({
	id: z.string(),
	taskId: z.string(),
	content: z.string(),
	stream: logStreamSchema,
	createdAt: z.string(),
});

export const configSchema = z.object({
	key: z.string(),
	value: z.string(),
});

// --- Server Logging ---

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export const logSourceSchema = z.enum(["server", "ws", "orchestrator", "db"]);

export const serverLogSchema = z.object({
	id: z.string(),
	level: logLevelSchema,
	source: logSourceSchema,
	message: z.string(),
	meta: z.string().nullable(),
	createdAt: z.string(),
});

// Discovery result schemas
export const discoveryIssueSchema = z.object({
	title: z.string().min(1),
	prompt: z.string().min(1),
});

export const discoveryResultSchema = z.array(discoveryIssueSchema);

/**
 * Validates that a path looks like an absolute path and contains no traversal segments.
 * Runtime checks (existence, is-directory) happen in the ws handler.
 */
export const absolutePathSchema = z
	.string()
	.min(1)
	.refine((p) => p.startsWith("/"), { message: "Path must be absolute (start with /)" })
	.refine((p) => !/(^|\/)\.\.(\/|$)/.test(p), { message: "Path must not contain '..' segments" });

// Client message schemas
export const clientMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("create_project"),
		name: z.string().min(1),
		path: absolutePathSchema,
		commandId: z.string().optional(),
	}),
	z.object({ type: z.literal("delete_project"), projectId: z.string(), commandId: z.string().optional() }),
	z.object({
		type: z.literal("add_task"),
		projectId: z.string(),
		prompt: z.string().max(50_000),
		commandId: z.string().optional(),
	}),
	z.object({ type: z.literal("cancel_task"), taskId: z.string(), commandId: z.string().optional() }),
	z.object({ type: z.literal("remove_task"), taskId: z.string(), commandId: z.string().optional() }),
	z.object({ type: z.literal("retry_task"), taskId: z.string(), commandId: z.string().optional() }),
	z.object({
		type: z.literal("get_task_logs"),
		taskId: z.string(),
		limit: z.number().int().min(1).max(2000).optional(),
		before: z.string().optional(),
		commandId: z.string().optional(),
	}),
	z.object({
		type: z.literal("set_config"),
		key: z.string().regex(/^(auto_continue|custom_instructions):/, {
			message: "Only auto_continue and custom_instructions config keys are client-settable",
		}),
		value: z.string().max(10_000),
		commandId: z.string().optional(),
	}),
	z.object({
		type: z.literal("start_project"),
		projectId: z.string(),
		mode: z.enum(["discover", "execute"]),
		commandId: z.string().optional(),
	}),
	z.object({ type: z.literal("stop_project"), projectId: z.string(), commandId: z.string().optional() }),
	z.object({
		type: z.literal("get_server_logs"),
		limit: z.number().optional(),
		level: logLevelSchema.optional(),
		commandId: z.string().optional(),
	}),
]);
