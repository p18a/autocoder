import { ulid } from "ulid";
import type { JournalEntry, JournalTier } from "../../shared/types.ts";
import { db } from "./connection.ts";

class JournalEntryRow implements JournalEntry {
	id!: string;
	projectId!: string;
	content!: string;
	tier!: JournalTier;
	createdAt!: string;
}

class CountRow {
	count!: number;
}

const JOURNAL_COLS = "id, project_id AS projectId, content, tier, created_at AS createdAt";

const insertEntry = db.prepare(
	"INSERT INTO journal_entries (id, project_id, content, tier, created_at) VALUES (?, ?, ?, ?, ?)",
);
const selectRecentByProject = db
	.prepare(`SELECT ${JOURNAL_COLS} FROM journal_entries WHERE project_id = ? ORDER BY rowid DESC LIMIT ?`)
	.as(JournalEntryRow);
const selectByProjectAndTier = db
	.prepare(`SELECT ${JOURNAL_COLS} FROM journal_entries WHERE project_id = ? AND tier = ? ORDER BY rowid DESC LIMIT ?`)
	.as(JournalEntryRow);
const searchByProject = db
	.prepare(
		`SELECT ${JOURNAL_COLS} FROM journal_entries WHERE project_id = ? AND content LIKE ? ORDER BY rowid DESC LIMIT ?`,
	)
	.as(JournalEntryRow);
const countByProjectAndTier = db
	.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE project_id = ? AND tier = ?")
	.as(CountRow);
const countByProject = db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE project_id = ?").as(CountRow);
const selectOldestRecentEntries = db
	.prepare(
		`SELECT ${JOURNAL_COLS} FROM journal_entries WHERE project_id = ? AND tier = 'recent' ORDER BY created_at ASC LIMIT ?`,
	)
	.as(JournalEntryRow);
const selectOldestSummaryEntries = db
	.prepare(
		`SELECT ${JOURNAL_COLS} FROM journal_entries WHERE project_id = ? AND tier = 'summary' ORDER BY created_at ASC LIMIT ?`,
	)
	.as(JournalEntryRow);
const deleteEntry = db.prepare("DELETE FROM journal_entries WHERE id = ?");
const deleteByProjectAndTier = db.prepare("DELETE FROM journal_entries WHERE project_id = ? AND tier = ?");

export function appendJournalEntry(projectId: string, content: string, tier: JournalTier = "recent"): JournalEntry {
	const id = ulid();
	const now = new Date().toISOString();
	insertEntry.run(id, projectId, content, tier, now);
	return { id, projectId, content, tier, createdAt: now };
}

export function getJournalEntries(projectId: string, limit = 10): JournalEntry[] {
	const rows = selectRecentByProject.all(projectId, limit);
	rows.reverse();
	return rows;
}

export function getJournalEntriesByTier(projectId: string, tier: JournalTier, limit = 50): JournalEntry[] {
	const rows = selectByProjectAndTier.all(projectId, tier, limit);
	rows.reverse();
	return rows;
}

export function searchJournalEntries(projectId: string, query: string, limit = 10): JournalEntry[] {
	const rows = searchByProject.all(projectId, `%${query}%`, limit);
	rows.reverse();
	return rows;
}

export function getJournalEntryCount(projectId: string, tier?: JournalTier): number {
	if (tier) {
		return countByProjectAndTier.get(projectId, tier)?.count ?? 0;
	}
	return countByProject.get(projectId)?.count ?? 0;
}

export function getOldestRecentEntries(projectId: string, limit: number): JournalEntry[] {
	return selectOldestRecentEntries.all(projectId, limit);
}

export function getOldestSummaryEntries(projectId: string, limit: number): JournalEntry[] {
	return selectOldestSummaryEntries.all(projectId, limit);
}

export function removeJournalEntry(id: string): boolean {
	return deleteEntry.run(id).changes > 0;
}

export function clearJournalTier(projectId: string, tier: JournalTier): number {
	return deleteByProjectAndTier.run(projectId, tier).changes;
}
