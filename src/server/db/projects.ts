import { ulid } from "ulid";
import type { Project } from "../../shared/types.ts";
import { db } from "./connection.ts";

class ProjectRow implements Project {
	id!: string;
	name!: string;
	path!: string;
	createdAt!: string;
	updatedAt!: string;
}

const PROJECT_COLS = "id, name, path, created_at AS createdAt, updated_at AS updatedAt";

const insertProject = db.prepare(
	"INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
);
const selectProject = db.prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`).as(ProjectRow);
const selectAllProjects = db.prepare(`SELECT ${PROJECT_COLS} FROM projects ORDER BY created_at DESC`).as(ProjectRow);
const deleteProjectStmt = db.prepare("DELETE FROM projects WHERE id = ?");
const deleteTaskLogsByProject = db.prepare(
	"DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)",
);
const deleteTasksByProject = db.prepare("DELETE FROM tasks WHERE project_id = ?");
const CONFIG_PREFIXES = [
	"started",
	"auto_continue",
	"custom_instructions",
	"discovery_fail_streak",
	"timeout_minutes",
	"verify_command",
	"discovery_mode",
	"project_purpose",
];
const deleteConfigByKey = db.prepare("DELETE FROM config WHERE key = ?");
const deleteJournalByProject = db.prepare("DELETE FROM journal_entries WHERE project_id = ?");

export function createProject(name: string, path: string): Project {
	const id = ulid();
	const now = new Date().toISOString();
	insertProject.run(id, name, path, now, now);
	return { id, name, path, createdAt: now, updatedAt: now };
}

export function getProject(id: string): Project | null {
	return selectProject.get(id) ?? null;
}

export function listProjects(): Project[] {
	return selectAllProjects.all();
}

export function deleteProject(id: string): boolean {
	const result = deleteProjectStmt.run(id);
	return result.changes > 0;
}

export function deleteProjectCascade(id: string): boolean {
	return db.transaction(() => {
		deleteTaskLogsByProject.run(id);
		deleteTasksByProject.run(id);
		deleteJournalByProject.run(id);
		for (const prefix of CONFIG_PREFIXES) {
			deleteConfigByKey.run(`${prefix}:${id}`);
		}
		const result = deleteProjectStmt.run(id);
		return result.changes > 0;
	})();
}
