import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import * as db from "../db/index.ts";
import { startProject, stopProject } from "../orchestrator/index.ts";
import type { Handler } from "./types.ts";

/**
 * Validate that a project path resolves to an existing directory.
 * Throws with a user-friendly message on failure.
 */
async function validateProjectPath(rawPath: string): Promise<string> {
	const resolved = resolve(rawPath);
	let s: Awaited<ReturnType<typeof stat>>;
	try {
		s = await stat(resolved);
	} catch {
		throw new Error(`Path does not exist: ${resolved}`);
	}
	if (!s.isDirectory()) {
		throw new Error(`Path is not a directory: ${resolved}`);
	}
	return resolved;
}

export const handleCreateProject: Handler<"create_project"> = async (ctx, msg) => {
	const resolvedPath = await validateProjectPath(msg.path);
	const project = db.createProject(msg.name, resolvedPath);
	ctx.broadcast({ type: "project_created", project });
};

export const handleDeleteProject: Handler<"delete_project"> = async (ctx, msg) => {
	await stopProject(msg.projectId);
	if (db.deleteProjectCascade(msg.projectId)) {
		ctx.broadcast({ type: "project_deleted", projectId: msg.projectId });
	}
};

export const handleStartProject: Handler<"start_project"> = async (ctx, msg) => {
	if (!db.getProject(msg.projectId)) {
		ctx.sendTo(ctx.ws, { type: "error", message: `Project ${msg.projectId} not found` });
		return;
	}
	await startProject(msg.projectId, msg.mode);
};

export const handleStopProject: Handler<"stop_project"> = async (ctx, msg) => {
	if (!db.getProject(msg.projectId)) {
		ctx.sendTo(ctx.ws, { type: "error", message: `Project ${msg.projectId} not found` });
		return;
	}
	await stopProject(msg.projectId);
};
